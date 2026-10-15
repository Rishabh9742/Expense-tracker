import type { NextAuthConfig } from "next-auth";

// Edge-safe configuration shared by middleware and the full auth setup.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7, updateAge: 60 * 60 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === "/login" ||
        pathname === "/register" ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/cron") ||
        pathname.startsWith("/api/health");
      if (isPublic) return true;
      if (auth?.user) return true;
      // APIs answer 401 instead of redirecting to the login page.
      if (pathname.startsWith("/api/")) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return false;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
