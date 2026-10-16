from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("simulate", "0100_harness_agent_runtime_hash_scope"),
    ]

    operations = [
        migrations.AddField(
            model_name="harnessagentversionruntime",
            name="check_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
