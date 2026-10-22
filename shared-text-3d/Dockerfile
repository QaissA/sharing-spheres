# Hugging Face Space (Docker SDK): paste this as the Space's Dockerfile.
# It builds from the public GitHub repo, so the Space needs no other files.
FROM node:22
WORKDIR /app
# Changes whenever main moves, so a Space restart picks up new commits instead of a cached clone
ADD https://api.github.com/repos/QaissA/sharing-spheres/git/refs/heads/main /tmp/main.json
RUN git clone --depth 1 https://github.com/QaissA/sharing-spheres.git . && cd shared-text-3d && npm ci && npm run build
WORKDIR /app/shared-text-3d
# 7860 is the port Hugging Face routes to by default
ENV PORT=7860 CLIENT_ORIGIN=https://sharing-spheres.vercel.app
EXPOSE 7860
CMD ["node", "server.ts"]
