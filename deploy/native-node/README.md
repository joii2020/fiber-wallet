
# Native Node WSS Deployment Guide

If the frontend is served over `https`, browser security policies require that the native node's `ws` connection must also use TLS, i.e., upgrade to `wss`.

This directory uses Nginx as a reverse proxy to provide a `wss` entry point for the local `ws` service. Self-signed certificates can be used for testing environments; for `mainnet` or other production environments, properly issued certificates should be used.

The Nginx configuration file is located at `deploy/native-node/nginx.config`. The following commands are used to generate a self-signed certificate:

```bash
cd deploy/native-node/
mkdir ssl
cd ssl

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout nginx.key \
    -out nginx.crt \
    -subj "/CN=localhost" 2>/dev/null
```

Start Nginx:
```bash
nginx -p "$PWD" -c "deploy/native-node/nginx.config"
```

When connecting, change the address to the port exposed by Nginx (here `8249`) and replace the protocol from `ws` to `wss`.

For example:

```text
/ip4/127.0.0.1/tcp/8248/ws/p2p/QmPrG1pXePJ6hvGqepYY3wbAd2nk41mFCUJpL379zVspiz -> /ip4/127.0.0.1/tcp/8249/wss/p2p/QmPrG1pXePJ6hvGqepYY3wbAd2nk41mFCUJpL379zVspiz
```


## Importing the Certificate via GUI

After the certificate is generated, you need to import `deploy/native-node/ssl/nginx.crt` into your system's trusted certificate list. Otherwise, the browser will still display a certificate warning when accessing `https://localhost:8249` or `wss://localhost:8249`.


### Windows

- If you use Chrome, open in the browser:
  `Settings -> Privacy and security -> Security -> Manage device certificates`
- In the system certificate management window, import `nginx.crt` into "Trusted Root Certification Authorities".

### macOS

- Open "Keychain Access".
- Select the `System` or `login` keychain, drag `nginx.crt` into it, or import the certificate via the menu.
- Double-click the imported certificate, and under "Trust", change "When using this certificate" to "Always Trust".
- Close the window and enter your system password to save the changes.

### Linux

- The certificate import process varies depending on the Linux distribution and browser.
- If you use Chrome, open in the browser:
  `Settings -> Privacy and security -> Security -> Manage device certificates`
- Then import `nginx.crt` in the system certificate management interface and add it to the trusted certificate list.
- The name of the system certificate GUI may differ across distributions, but it typically opens the system's built-in certificate management tool.
