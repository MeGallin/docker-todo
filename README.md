# Docker Text

Monorepo for a Dockerised API and its client application.

## API

Run locally with Node:

```sh
cd API
npm install
npm start
```

Run locally with Docker:

```sh
docker build -t docker-text-api ./API
docker run --rm -p 10000:10000 docker-text-api
```

The API is available at `http://localhost:10000`, with a health check at
`http://localhost:10000/health`.

For Render, create a Web Service from this repository, select Docker, set the
Dockerfile path to `API/Dockerfile`, and set the health check path to `/health`.
