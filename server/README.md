# Jogurt community server
Hosts public user profiles for Jogurt Client. Needs Node 18+ and no npm packages.

    node server.js          # listens on PORT (default 3000), stores data.json

Deploy it anywhere that runs Node (a VPS, Render, Railway, Fly.io). Put it behind HTTPS, then paste its URL
into Jogurt Client > Settings > Community server (or into config.json before building).
Users are verified with their Minecraft access token (checked with Mojang), so nobody can edit someone else's profile.
