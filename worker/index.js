export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Keep this proxy deliberately narrow: it can call only TagIn's phone-login
    // function. It never accepts a caller-supplied upstream URL or logs credentials.
    if (url.pathname === "/api/auth/phone-password-login") {
      if (request.method !== "POST") {
        return new Response(null, {
          status: request.method === "OPTIONS" ? 204 : 405,
          headers: { "Allow": "POST, OPTIONS", "Cache-Control": "no-store" },
        });
      }

      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return Response.json({ error: "Invalid request" }, {
          status: 415,
          headers: { "Cache-Control": "no-store" },
        });
      }

      const body = await request.text();
      if (body.length > 8192) {
        return Response.json({ error: "Request too large" }, {
          status: 413,
          headers: { "Cache-Control": "no-store" },
        });
      }

      let upstreamUrl;
      try {
        upstreamUrl = new URL("/functions/v1/phone-password-login", env.SUPABASE_URL);
      } catch {
        return Response.json({ error: "Authentication service unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }

      try {
        const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
        if (!publishableKey) {
          return Response.json({ error: "Authentication service is not configured" }, {
            status: 503,
            headers: { "Cache-Control": "no-store" },
          });
        }

        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": publishableKey,
            "x-client-info": "tagin-cloudflare-login-proxy/1.0",
          },
          body,
          redirect: "error",
        });
        const headers = new Headers();
        headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
        headers.set("Cache-Control", "no-store");
        return new Response(upstream.body, {
          status: upstream.status,
          headers,
        });
      } catch {
        return Response.json({ error: "Authentication service unavailable" }, {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
