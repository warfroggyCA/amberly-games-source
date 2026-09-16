import { X509Certificate } from "node:crypto";
import { checkServerIdentity, type ConnectionOptions } from "node:tls";

/** Shared by the server and operator bootstrap; remote connections always verify TLS. */
export function databaseTls(
  address: URL,
  certificate = process.env.SCRABBLE_DATABASE_CA_CERT,
): ConnectionOptions | false {
  if (["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
    return false;

  const options: ConnectionOptions = {
    rejectUnauthorized: true,
    checkServerIdentity,
  };
  if (certificate !== undefined) {
    const pem = certificate.replace(/\\n/g, "\n").trim();
    try {
      if (
        !pem.startsWith("-----BEGIN CERTIFICATE-----") ||
        !pem.endsWith("-----END CERTIFICATE-----") ||
        !new X509Certificate(pem).ca
      )
        throw new Error("Invalid CA");
    } catch {
      throw new Error(
        "SCRABBLE_DATABASE_CA_CERT must contain a valid PEM CA certificate.",
      );
    }
    options.ca = pem;
  }
  return options;
}
