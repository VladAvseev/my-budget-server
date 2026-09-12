# Fail2ban + ufw на боевом сервере (Reg.облако, Ubuntu 24.04)

Закрытая настройка: наружу открыты только 22 (SSH), 80 и 443 (хостовый nginx).
Docker-стек наружу портов не публикует (`db` — без ports, `api` — только
`expose`, `web` — `127.0.0.1:8080`), поэтому ufw его не касается и не конфликтует
с docker-NAT. Вход по SSH — только по ключу, поэтому риск само-бана минимален;
открытая SSH-сессия при бане не рвётся (ufw пропускает established-трафик).

## Восстановление на свежей машине

```bash
sudo apt update && sudo apt install -y ufw fail2ban
sudo systemctl enable --now fail2ban

# Файрвол: порядок важен — сначала правила, потом enable (сессия не разорвётся)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw default deny routed
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP+ACME'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw --force enable
sudo ufw status verbose

# Fail2ban: кладём локальные override-файлы (shipped-конфиги не правим никогда)
sudo cp jail.local     /etc/fail2ban/jail.local
sudo cp fail2ban.local /etc/fail2ban/fail2ban.local
sudo fail2ban-client -t
sudo systemctl restart fail2ban
```

## Проверка, что всё живое

```bash
sudo fail2ban-client status          # jail list: nginx-botsearch, recidive, sshd
sudo fail2ban-client status sshd     # Total failed > 0 = джейл читает журнал
sudo grep -c Ban /var/log/fail2ban.log
sudo ufw status | grep -i deny       # баны появляются здесь (banaction = ufw)
sudo ss -tulpn                       # снаружи только 22/80/443; 8080 — 127.0.0.1
```

## Если забанил себя (или нужно срочно снять бан)

Через веб-консоль (VNC) в панели Рег.облака:

```bash
sudo fail2ban-client set sshd unbanip <ТВОЙ_IP>
```

## Грабли, учтённые в конфиге

- **Ubuntu 24.04**: юнит называется `ssh.service` (не `sshd.service`), и
  `/var/log/auth.log` может отсутствовать — без `backend = systemd` +
  явного `journalmatch` джейл стартует, «работает» и банит ноль человек.
- **Пакетный `jail.d/defaults-debian.conf`** включает sshd и ставит
  `banaction = nftables`; `jail.local` читается после и перебивает на
  `banaction = ufw`, иначе баны уходят в отдельную nftables-таблицу и не
  видны в `ufw status`. После смены banaction старую пустую
  `inet f2b-table` чистят: `sudo nft delete table inet f2b-table`.
- **`recidive`** обязан быть на `backend = auto` + `logpath` — читает
  собственный файл `/var/log/fail2ban.log`, а не журнал.
- **`bantime.increment`**: разовый промах = 1 час, злостные добирают до
  недели; GitLab CI (деплои по SSH) при ключевой аутентификации баниться
  не должен, в ignoreip его динамические IP не зносим — это не граница
  доверия.
- **Будущие опубликованные docker-порты ufw НЕ защищаются** (Docker DNAT'ит
  до INPUT-цепочек) — фильтровать надо в цепочке `DOCKER-USER`, см.
  <https://docs.docker.com/engine/network/firewall-iptables/>.
