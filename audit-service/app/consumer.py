import json
import pika
from app.mongo import collection
from app.schema import AuditEvent
import os

def callback(ch, method, properties, body):
    event = json.loads(body)

    # Validate schema
    AuditEvent(**event)

    # Insert-only (NO updates ever)
    collection.insert_one(event)

    ch.basic_ack(delivery_tag=method.delivery_tag)

# def start_consumer():
#     connection = pika.BlockingConnection(
#         pika.URLParameters(os.getenv("RABBITMQ_URL"))
#     )
#     channel = connection.channel()

#     channel.exchange_declare(
#         exchange="audits",
#         exchange_type="topic",
#         durable=True
#     )

#     channel.queue_declare(queue="audit_logs", durable=True)

#     channel.queue_bind(
#         exchange="audits",
#         queue="audit_logs",
#         routing_key="audit.#"
#     )

#     channel.basic_consume(
#         queue="audit_logs",
#         on_message_callback=callback
#     )

#     print("🟢 Audit Service Started")
#     channel.start_consuming()

def start_consumer():
    url = os.getenv("RABBITMQ_URL")

    while True:
        try:
            print("🔄 Connecting to RabbitMQ...", flush=True)

            connection = pika.BlockingConnection(
                pika.URLParameters(url)
            )
            channel = connection.channel()

            channel.exchange_declare(
                exchange="audits",
                exchange_type="topic",
                durable=True
            )

            channel.queue_declare(queue="audit_logs", durable=True)

            channel.queue_bind(
                exchange="audits",
                queue="audit_logs",
                routing_key="audit.#"
            )

            channel.basic_consume(
                queue="audit_logs",
                on_message_callback=callback
            )

            print("🟢 Audit Service Started & Connected to RabbitMQ", flush=True)
            channel.start_consuming()

        except pika.exceptions.AMQPConnectionError:
            print("❌ RabbitMQ not ready. Retrying in 5 seconds...", flush=True)
            time.sleep(5)

        except Exception as e:
            print(f"❌ Consumer crashed: {e}. Restarting in 5s...", flush=True)
            time.sleep(5)