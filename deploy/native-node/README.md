
# Native Node WSS Deployment Guide

If the frontend is served over `https`, browser security policies require that the native node's `ws` connection must also use TLS, i.e. upgrade to `wss`.

This directory uses Nginx as a reverse proxy to provide a `wss` entry point for the local `ws` service. For local testing, use a private root CA and sign the Nginx server certificate with it. For `mainnet` or other production environments, use a properly issued certificate instead.

The Nginx configuration file is located at `deploy/native-node/nginx.config`. When the page or node is accessed through a LAN IP, the server certificate must include that IP in `subjectAltName`; `CN=localhost` alone is not enough for modern browsers or iPhone Safari.

## Generate a Local Root CA and Server Certificate

The commands below:

- create a local root CA
- generate an Nginx server key and CSR
- sign the server certificate with the local root CA
- include `localhost`, `127.0.0.1`, and `192.168.3.26` in `subjectAltName`

Replace `192.168.3.26` with your actual LAN IP before running the commands.

```bash
cd deploy/native-node/
mkdir -p ssl
cd ssl

cat > ca-openssl.cnf <<'EOF'
[req]
default_bits = 4096
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ca

[dn]
CN = Fiber Wallet Local Root CA

[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:1
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
EOF

openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
    -keyout local-root-ca.key \
    -out local-root-ca.crt \
    -config ca-openssl.cnf

cat > nginx-openssl.cnf <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
CN = 192.168.3.26

[v3_req]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = 192.168.3.26
EOF

openssl req -nodes -newkey rsa:2048 \
    -keyout nginx.key \
    -out nginx.csr \
    -config nginx-openssl.cnf

openssl x509 -req -days 825 \
    -in nginx.csr \
    -CA local-root-ca.crt \
    -CAkey local-root-ca.key \
    -CAcreateserial \
    -out nginx.crt \
    -extensions v3_req \
    -extfile nginx-openssl.cnf
```

The generated files are:

- `local-root-ca.crt`: import and trust this on client devices
- `local-root-ca.key`: keep this private
- `nginx.crt`: server certificate used by Nginx
- `nginx.key`: server private key used by Nginx

If your machine's LAN IP changes, update `CN` and `IP.2`, then regenerate `nginx.key`, `nginx.csr`, and `nginx.crt`. You can keep using the same `local-root-ca.crt` and `local-root-ca.key`.

Start Nginx:
```bash
nginx -p "$PWD" -c "deploy/native-node/nginx.config"
```

When connecting, change the address to the port exposed by Nginx (here `8249`) and replace the protocol from `ws` to `wss`.

For example:

```text
/ip4/127.0.0.1/tcp/8248/ws/p2p/QmPrG1pXePJ6hvGqepYY3wbAd2nk41mFCUJpL379zVspiz -> /ip4/127.0.0.1/tcp/8249/wss/p2p/QmPrG1pXePJ6hvGqepYY3wbAd2nk41mFCUJpL379zVspiz
```


## Trust the Root CA on Client Devices

After the certificates are generated, trust `deploy/native-node/ssl/local-root-ca.crt` on each client device that will open `https://...` or `wss://...`.

Do not import `nginx.crt` as a trusted root. The server should present `nginx.crt`, while clients should trust `local-root-ca.crt`.

### macOS

Import the root CA into the system keychain:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  deploy/native-node/ssl/local-root-ca.crt
```

You can also use Keychain Access manually:

- Open `Keychain Access`
- Import `local-root-ca.crt` into the `System` keychain
- Open the certificate details and set `Trust -> When using this certificate` to `Always Trust`

### Linux

The exact trust store path depends on the distribution, but these are the most common cases.

Debian / Ubuntu:

```bash
sudo cp deploy/native-node/ssl/local-root-ca.crt /usr/local/share/ca-certificates/fiber-wallet-local-root-ca.crt
sudo update-ca-certificates
```

RHEL / CentOS / Fedora:

```bash
sudo cp deploy/native-node/ssl/local-root-ca.crt /etc/pki/ca-trust/source/anchors/fiber-wallet-local-root-ca.crt
sudo update-ca-trust extract
```

If your browser uses its own certificate store, import `local-root-ca.crt` there as well.

### iPhone / iPad

- Send `local-root-ca.crt` to the device and install the profile
- Open `Settings -> General -> VPN & Device Management` and complete installation if prompted
- Open `Settings -> General -> About -> Certificate Trust Settings`
- Enable full trust for `Fiber Wallet Local Root CA`

After that, Safari can validate `https://192.168.3.26:8249` and `wss://192.168.3.26:8249` as long as the server certificate includes `192.168.3.26` in `subjectAltName`
