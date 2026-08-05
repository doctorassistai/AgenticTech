from fastapi import Request

def get_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()  # real browser IP

    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip:
        return x_real_ip

    return request.client.host if request.client else "unknown"