# GPU Droplet (Gemma + SDXL-Turbo)

One DigitalOcean GPU Droplet runs both open models:

- **Gemma 4 E4B** through Ollama's OpenAI-compatible API. Mastra talks to it like any provider.
- **SDXL-Turbo** img2img, which redraws a Wikimedia Commons photo as a crayon sketch.
- **Caddy** in front: real HTTPS via `<ip>.sslip.io` plus a bearer key. Ollama itself has no auth.

Size: **RTX 4000 Ada (20 GB GPU memory, about $0.76/hr)**. Gemma 4 E4B takes about 6-9 GB and
SDXL-Turbo in fp16 about 7 GB, so both fit together. For better writing, use an L40S (48 GB,
about $1.57/hr) with `GEMMA_MODEL=gemma4:26b`.

## Costs: read this first

**A powered-off Droplet is still billed.** To stop paying, snapshot it and then destroy it.
The snapshot costs roughly $0.06/GB per month, and bringing it back takes a few minutes.

## Create (DigitalOcean control panel)

1. Create → GPU Droplets → RTX 4000 Ada, the **AI/ML Ready** image, and your SSH key.
2. `scp gpu/setup.sh gpu/sketch_server.py root@<ip>:/root/`
3. `ssh root@<ip> 'LUMI_KEY=<long-random> GEMMA_MODEL=gemma4:e4b bash setup.sh'`
4. Copy the printed `GEMMA_BASE_URL` / `SKETCH_URL` into `.env.local` and into the App Platform env.

## Check

```bash
curl -H "Authorization: Bearer $KEY" https://<host>/health
curl -H "Authorization: Bearer $KEY" https://<host>/v1/models
curl https://<host>/v1/models      # must say: unauthorized
```

## Stop paying / start again (`doctl`)

```bash
doctl compute droplet-action snapshot <id> --snapshot-name lumiroam-gpu --wait
doctl compute droplet delete <id>
# later:
# size slug: check `doctl compute size list | grep -i gpu` (e.g. the RTX 4000 Ada one)
doctl compute droplet create lumiroam-gpu --image <snapshot-id> --size <gpu-size-slug> --region <region> --ssh-keys <key-id> --wait
```

The IP changes when you recreate it, so the `sslip.io` hostname and Caddy's config change too.
Rerun the Caddy part of `setup.sh` (or use a reserved IP if your region supports it for GPU Droplets).

If the GPU is off, the app still works: plans use template text and sketches are drawn from
sun and geometry data.
