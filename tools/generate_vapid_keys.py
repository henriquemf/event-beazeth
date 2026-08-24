import base64

from cryptography.hazmat.primitives.asymmetric import ec


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def main():
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_num = private_key.private_numbers().private_value
    private_bytes = private_num.to_bytes(32, "big")

    public_numbers = private_key.public_key().public_numbers()
    x = public_numbers.x.to_bytes(32, "big")
    y = public_numbers.y.to_bytes(32, "big")
    public_bytes = b"\x04" + x + y

    print("VAPID_PUBLIC_KEY=" + b64url(public_bytes))
    print("VAPID_PRIVATE_KEY=" + b64url(private_bytes))


if __name__ == "__main__":
    main()
