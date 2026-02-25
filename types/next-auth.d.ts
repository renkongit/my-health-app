import "next-auth";

declare module "next-auth" {
  interface JWT {
    access_token?: string;
  }
}
