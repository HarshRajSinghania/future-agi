import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("simulate", "0101_harness_agent_runtime_check_started_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="harnessnudge",
            name="command_message",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="simulate.hostedharnessconversationmessage",
            ),
        ),
        migrations.AddField(
            model_name="harnessnudge",
            name="closed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
