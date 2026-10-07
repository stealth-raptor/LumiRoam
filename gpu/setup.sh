#!/usr/bin/env bash
# One-time setup for the LumiRoam GPU Droplet (DigitalOcean "AI/ML Ready" Ubuntu image, which
# already has the NVIDIA driver and CUDA). Run as root on the Droplet:
#
#   LUMI_KEY=<long random string> GEMMA_MODEL=gemma4:e4b bash setup.sh
#
# Afterwards:
#   https://<ip-with-dashes>.sslip.io/v1/...    -> Ollama (OpenAI-compatible) running Gemma
#   https://<ip-with-dashes>.sslip.io/sketch    -> SDXL-Turbo crayon sketches
# Both require "Authorization: Bearer $LUMI_KEY". Nothing else is exposed.
set -euo pipefail

: "${LUMI_KEY:?set LUMI_KEY to a long random string}"
GEMMA_MODEL="${GEMMA_MODEL:-gemma4:e4b}"
IP=$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)
HOST="${IP//./-}.sslip.io"   # free wildcard DNS, so Caddy can get a real Let's Encrypt cert
echo "==> Host will be https://$HOST"

nvidia-smi --query-gpu=name,memory.total --format=csv

echo "==> Firewall: only SSH and HTTPS"
ufw allow OpenSSH
ufw allow 80/tcp    # Let's Encrypt HTTP challenge
ufw allow 443/tcp
ufw --force enable

echo "==> Ollama (Gemma), bound to localhost only"
curl -fsSL https://ollama.com/install.sh | sh
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<EOF
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=2"
EOF
systemctl daemon-reload && systemctl restart ollama
sleep 3
ollama pull "$GEMMA_MODEL"

echo "==> Sketch server (SDXL-Turbo)"
apt-get update -y && apt-get install -y python3-venv
mkdir -p /opt/lumiroam && cp "$(dirname "$0")/sketch_server.py" /opt/lumiroam/
python3 -m venv /opt/lumiroam/venv
/opt/lumiroam/venv/bin/pip install --quiet torch diffusers transformers accelerate fastapi "uvicorn[standard]" pillow requests
cat > /etc/systemd/system/lumiroam-sketch.service <<EOF
[Unit]
Description=LumiRoam SDXL-Turbo sketch server
After=network-online.target

[Service]
WorkingDirectory=/opt/lumiroam
ExecStart=/opt/lumiroam/venv/bin/uvicorn sketch_server:app --host 127.0.0.1 --port 8001
Restart=always
Environment=HF_HOME=/opt/lumiroam/hf

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now lumiroam-sketch

echo "==> Caddy: HTTPS + bearer key in front of both"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  # route keeps the literal order. Caddy's default order runs handle blocks before respond,
  # which would skip the key check entirely.
  route {
    @unauthorized not header Authorization "Bearer $LUMI_KEY"
    respond @unauthorized "unauthorized" 401
    reverse_proxy /v1/* 127.0.0.1:11434
    reverse_proxy /sketch 127.0.0.1:8001
    reverse_proxy /health 127.0.0.1:8001
    respond 404
  }
}
EOF
systemctl restart caddy

echo "==> Warm-up (first sketch downloads ~7 GB of weights)"
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8001/health && break; sleep 10; done
echo
echo "Done. In the app's .env.local:"
echo "  GEMMA_BASE_URL=https://$HOST/v1"
echo "  GEMMA_MODEL=$GEMMA_MODEL"
echo "  SKETCH_URL=https://$HOST"
echo "  GEMMA_API_KEY=<the LUMI_KEY you chose>"
