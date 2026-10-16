from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("simulate", "0098_sub_actors")]

    operations = [
        migrations.AlterField(
            model_name="chatmessagemodel",
            name="role",
            field=models.CharField(
                choices=[
                    ("user", "User"),
                    ("assistant", "Assistant"),
                    ("tool", "Tool"),
                    ("sub_actor", "Sub-actor"),
                ],
                help_text="Role of the message sender (user or assistant)",
                max_length=20,
            ),
        ),
    ]
