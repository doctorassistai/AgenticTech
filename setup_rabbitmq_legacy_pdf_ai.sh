#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Configuration
CONTAINER_NAME="rabbitmq"
VHOST_NAME="legacy_pdf_ai"
USERNAME="legacy_ai_user"
PASSWORD="strongpassword"

echo "🔍 Listing existing vhosts..."
docker exec -it "$CONTAINER_NAME" rabbitmqctl list_vhosts

echo "➕ Adding vhost: $VHOST_NAME"
docker exec -it "$CONTAINER_NAME" rabbitmqctl add_vhost "$VHOST_NAME" || \
  echo "⚠️  Vhost $VHOST_NAME already exists"

echo "📋 Listing vhosts after creation..."
docker exec -it "$CONTAINER_NAME" rabbitmqctl list_vhosts

echo "👥 Listing existing users..."
docker exec -it "$CONTAINER_NAME" rabbitmqctl list_users

echo "➕ Adding user: $USERNAME"
docker exec -it "$CONTAINER_NAME" rabbitmqctl add_user "$USERNAME" "$PASSWORD" || \
  echo "⚠️  User $USERNAME already exists"

echo "🔐 Setting permissions for user $USERNAME on vhost $VHOST_NAME"
docker exec -it "$CONTAINER_NAME" rabbitmqctl set_permissions \
  -p "$VHOST_NAME" \
  "$USERNAME" \
  ".*" ".*" ".*"

echo "📋 Verifying permissions for user $USERNAME"
docker exec -it "$CONTAINER_NAME" rabbitmqctl list_user_permissions "$USERNAME"

echo "✅ RabbitMQ setup completed successfully."
