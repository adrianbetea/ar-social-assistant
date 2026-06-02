# Docker Setup: AI Services

This project uses Docker to run the necessary AI services locally:
1.  **LibreTranslate:** For language translation.
2.  **Whisper:** For speech-to-text transcription.

The `docker-compose.yml` file is configured to manage both services.

## Running the Services

### Create and Start (First Time)
This command will build the Whisper server image (if not already built) and pull the LibreTranslate image. It will then create and start both containers in detached mode (`-d`).

```bash
docker compose up -d
```

### Start Existing Containers
If the containers have been created previously and are stopped, use this command to start them again.

```bash
docker compose start
```

### Stop Containers
To stop the running services without removing them:

```bash
docker compose stop
```

### View Logs
To see the logs from the services (useful for debugging):

```bash
# View logs for both services
docker compose logs -f

# View logs for a specific service
docker compose logs -f libretranslate
docker compose logs -f whisper
```

### Recreate Containers
If you need to apply changes from the `docker-compose.yml` file or rebuild the Whisper image, you should stop and remove the old containers first, then bring them up again.

```bash
# Stop and remove existing containers
docker compose down

# Rebuild and start
docker compose up -d --build
```
