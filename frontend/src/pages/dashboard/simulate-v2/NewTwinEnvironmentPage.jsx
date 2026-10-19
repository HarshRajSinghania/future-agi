import { Helmet } from "react-helmet-async";
import NewTwinEnvironment from "src/sections/simulate-v2/environments/NewTwinEnvironment";

export default function NewTwinEnvironmentPage() {
  return (
    <>
      <Helmet>
        <title>New environment | Future AGI</title>
      </Helmet>
      <NewTwinEnvironment />
    </>
  );
}
