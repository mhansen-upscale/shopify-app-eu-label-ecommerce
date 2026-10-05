// Ersetzt app/shopify.server.ts im Test: authenticate.admin liefert den vom Test gesetzten Mock.
export const authenticate = { admin: async () => (globalThis as any).__mockAuth };
