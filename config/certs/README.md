# Database certificate trust

`supabase-ca-2021.crt` is the public Supabase Root 2021 CA downloaded on 2026-09-14 from the certificate link in Supabase's database SSL settings:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Its SHA-256 fingerprint is `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`. It expires on 2031-04-26 at 10:56:53 UTC. This file contains no private key or credentials.

Set the server environment variable `SCRABBLE_DATABASE_CA_CERT` to the PEM contents when the database certificate uses this root. Actual newlines and escaped `\n` sequences are accepted. The operator bootstrap uses the same variable. Do not use a file path as its value. Leave the variable absent for databases using the runtime's system certificate authorities; an empty or malformed supplied value is rejected.

Remote connections always verify both the certificate chain and hostname. Never disable verification to resolve certificate errors. Loopback-only development databases retain their existing non-TLS configuration. The checked-in certificate is not implicitly trusted: deployments must explicitly configure it and update that setting if Supabase rotates its CA.

Reference: [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).
