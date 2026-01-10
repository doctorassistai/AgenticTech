import pika
from .schema import AuditEvent


import pika
from .schema import AuditEvent

class AuditClient:
    def __init__(self, rabbitmq_url: str):
        self.params = pika.URLParameters(rabbitmq_url)

    def log(self, event: AuditEvent):
        try:
            connection = pika.BlockingConnection(self.params)
            channel = connection.channel()

            channel.exchange_declare(
                exchange="audits",
                exchange_type="topic",
                durable=True
            )

            channel.basic_publish(
                exchange="audits",
                routing_key="audit.event",
                body=event.json(),
                properties=pika.BasicProperties(
                    delivery_mode=2
                )
            )

            connection.close()

        except pika.exceptions.AMQPError as e:
            # NEVER let audits crash your API
            print(f"[AUDIT WARNING] {e}")


# class AuditClient:
#     def __init__(self, rabbitmq_url: str):
#         self.connection = pika.BlockingConnection(
#             pika.URLParameters(rabbitmq_url)
#         )
#         self.channel = self.connection.channel()

#         self.channel.exchange_declare(
#             exchange="audits",
#             exchange_type="topic",
#             durable=True
#         )

#     def log(self, event: AuditEvent):
#         self.channel.basic_publish(
#             exchange="audits",
#             routing_key="audit.event",
#             body=event.json(),
#             properties=pika.BasicProperties(
#                 delivery_mode=2  # persistent
#             )
#         )
