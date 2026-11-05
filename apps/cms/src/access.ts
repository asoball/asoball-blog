import type { Access, PayloadRequest } from "payload";
export const isAdmin = ({ req }: { req: PayloadRequest }): boolean =>
  req.user?.role === "admin";
export const publishedOnly: Access = ({ req }) =>
  isAdmin({ req }) || { _status: { equals: "published" } };
