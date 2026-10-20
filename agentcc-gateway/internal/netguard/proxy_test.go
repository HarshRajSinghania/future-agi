package netguard

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// testProxy is a forward proxy on loopback that answers every request itself
// and records what it was asked for: the absolute URL of a plain request, the
// authority of a CONNECT (which it refuses).
type testProxy struct {
	*httptest.Server
	mu    sync.Mutex
	asked []string
}

func newTestProxy(t *testing.T) *testProxy {
	t.Helper()
	p := &testProxy{}
	p.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		if r.Method == http.MethodConnect {
			p.asked = append(p.asked, "CONNECT "+r.Host)
		} else {
			p.asked = append(p.asked, r.Method+" "+r.URL.String())
		}
		p.mu.Unlock()
		if r.Method == http.MethodConnect {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		io.WriteString(w, "via proxy")
	}))
	t.Cleanup(p.Close)
	return p
}

func (p *testProxy) requests() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.asked...)
}

func (p *testProxy) url(t *testing.T) *url.URL {
	t.Helper()
	u, err := url.Parse(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// stubLookup makes checkHost see the given addresses for host names.
func stubLookup(t *testing.T, answers map[string][]string) {
	t.Helper()
	orig := lookupIPAddr
	lookupIPAddr = func(_ context.Context, host string) ([]net.IPAddr, error) {
		addrs, ok := answers[host]
		if !ok {
			return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
		}
		ips := make([]net.IPAddr, len(addrs))
		for i, a := range addrs {
			ips[i] = net.IPAddr{IP: net.ParseIP(a)}
		}
		return ips, nil
	}
	t.Cleanup(func() { lookupIPAddr = orig })
}

func proxiedClient(t *testing.T, allowPrivate bool, proxy func(*http.Request) (*url.URL, error)) *http.Client {
	t.Helper()
	dial, pick := Proxied(net.Dialer{}, allowPrivate, proxy)
	transport := &http.Transport{DialContext: dial, Proxy: pick}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport}
}

// expectRefused checks that a request was refused by the address check, with
// an error that leaves the address out.
func expectRefused(t *testing.T, client *http.Client, target string, leaks ...string) {
	t.Helper()
	resp, err := client.Get(target)
	if err == nil {
		resp.Body.Close()
		t.Fatalf("GET %s: status %d, want refused", target, resp.StatusCode)
	}
	var blocked *BlockedError
	if !errors.As(err, &blocked) {
		t.Fatalf("GET %s: %v, want a *BlockedError", target, err)
	}
	for _, leak := range leaks {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("GET %s: error %q names the address %s", target, err, leak)
		}
	}
}

// Through a proxy the dial reaches the proxy, so the destination is checked
// before the proxy is picked: an internal destination never reaches the
// proxy, while the proxy itself, on loopback, may be dialled.
func TestProxiedChecksTheDestinationNotTheProxy(t *testing.T) {
	proxy := newTestProxy(t)
	stubLookup(t, map[string][]string{
		"public.example":  {"203.0.113.7"},
		"rebind.example":  {"203.0.113.7", "10.0.0.5"},
		"private.example": {"10.0.0.5"},
	})
	client := proxiedClient(t, false, http.ProxyURL(proxy.url(t)))

	resp, err := client.Get("http://public.example/ok")
	if err != nil {
		t.Fatalf("a public destination through the proxy: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "via proxy" {
		t.Fatalf("body = %q, want the proxy's answer", body)
	}

	for _, tt := range []struct {
		target string
		leaks  []string
	}{
		{"http://169.254.169.254/latest/meta-data/", nil},
		{"https://169.254.169.254/", nil},
		{"http://[fd00:ec2::254]/", nil},
		{"http://10.1.2.3:8080/", nil},
		{"http://127.0.0.1:8080/", nil},
		{"http://[::1]/", nil},
		{"http://0.0.0.0/", nil},
		{"http://metadata.google.internal/computeMetadata/v1/", nil},
		{"http://METADATA.goog./", nil},
		// Every address a host resolves to must pass, not only the first.
		{"http://rebind.example/", []string{"10.0.0.5"}},
		{"https://private.example/", []string{"10.0.0.5"}},
	} {
		t.Run(tt.target, func(t *testing.T) {
			expectRefused(t, client, tt.target, tt.leaks...)
		})
	}

	if got := proxy.requests(); len(got) != 1 || got[0] != "GET http://public.example/ok" {
		t.Fatalf("the proxy was asked for %q, want only the public destination", got)
	}
}

// With the opt-in a private destination may go through the proxy; loopback
// and metadata addresses never do.
func TestProxiedPrivateDestinationNeedsOptIn(t *testing.T) {
	proxy := newTestProxy(t)
	client := proxiedClient(t, true, http.ProxyURL(proxy.url(t)))

	resp, err := client.Get("http://10.1.2.3:8080/model")
	if err != nil {
		t.Fatalf("a private destination with the opt-in: %v", err)
	}
	resp.Body.Close()
	expectRefused(t, client, "http://127.0.0.1:8080/")
	expectRefused(t, client, "http://169.254.169.254/")

	if got := proxy.requests(); len(got) != 1 || got[0] != "GET http://10.1.2.3:8080/model" {
		t.Fatalf("the proxy was asked for %q", got)
	}
}

// A host the proxy function sends direct (NO_PROXY) is still checked, and the
// exemption for the proxy's address does not let a request reach the proxy
// as its destination.
func TestProxiedDirectRequestsAreStillChecked(t *testing.T) {
	proxy := newTestProxy(t)
	proxyURL := proxy.url(t)
	stubLookup(t, map[string][]string{
		"public.example":   {"203.0.113.7"},
		"internal.example": {"10.0.0.8"},
	})
	direct := map[string]bool{"internal.example": true, "127.0.0.1": true}
	client := proxiedClient(t, false, func(req *http.Request) (*url.URL, error) {
		if direct[req.URL.Hostname()] {
			return nil, nil
		}
		return proxyURL, nil
	})

	// The proxy's address is now exempt from the dial check.
	resp, err := client.Get("http://public.example/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	expectRefused(t, client, "http://internal.example/", "10.0.0.8")
	expectRefused(t, client, proxy.URL+"/")

	if got := proxy.requests(); len(got) != 1 {
		t.Fatalf("the proxy was asked for %q, want only the public destination", got)
	}
}

// Only an address the proxy function returned skips the dial check, and only
// once it has been returned.
func TestProxiedDialExemptsOnlyThePickedProxy(t *testing.T) {
	proxy := newTestProxy(t)
	proxyURL := proxy.url(t)
	other := newTestProxy(t)
	dial, pick := Proxied(net.Dialer{}, false, http.ProxyURL(proxyURL))
	ctx := context.Background()

	var blocked *BlockedError
	if _, err := dial(ctx, "tcp", proxyURL.Host); !errors.As(err, &blocked) {
		t.Fatalf("dial before the proxy was picked = %v, want refused", err)
	}

	req, _ := http.NewRequest(http.MethodGet, "http://203.0.113.7/", nil)
	if got, err := pick(req); err != nil || got.String() != proxyURL.String() {
		t.Fatalf("pick = %v, %v", got, err)
	}
	conn, err := dial(ctx, "tcp", proxyURL.Host)
	if err != nil {
		t.Fatalf("dial the picked proxy: %v", err)
	}
	conn.Close()
	if _, err := dial(ctx, "tcp", strings.TrimPrefix(other.URL, "http://")); !errors.As(err, &blocked) {
		t.Fatalf("dial another loopback address = %v, want refused", err)
	}
}

func TestProxyAddr(t *testing.T) {
	for raw, want := range map[string]string{
		"http://proxy.corp:3128":    "proxy.corp:3128",
		"http://proxy.corp":         "proxy.corp:80",
		"https://proxy.corp":        "proxy.corp:443",
		"socks5://proxy.corp":       "proxy.corp:1080",
		"http://user:pw@[fd00::1]":  "[fd00::1]:80",
		"https://10.0.0.1:8443/pac": "10.0.0.1:8443",
	} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if got := proxyAddr(u); got != want {
			t.Errorf("proxyAddr(%s) = %q, want %q", raw, got, want)
		}
	}
}
