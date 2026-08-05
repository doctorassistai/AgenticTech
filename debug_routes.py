
import sys
import os

# Add current directory to path
sys.path.append(os.getcwd())

try:
    from Agentic.main import app
    print("Successfully imported app")
except Exception as e:
    print(f"Failed to import app: {e}")
    sys.exit(1)

print("\n--- Registered Routes ---")
for route in app.routes:
    if hasattr(route, "path"):
        methods = ", ".join(route.methods) if hasattr(route, "methods") else "None"
        print(f"{methods} {route.path}")
    else:
        print(f"Route: {route}")
print("--- End Routes ---\n")
