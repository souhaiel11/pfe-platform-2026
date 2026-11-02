"""Vérifie la disponibilité TCP sans dépendre des outils de l’image."""
import os
import socket
import unittest
os.environ.setdefault('AZURE_DEPLOY_AGENT_SECRET', 'offline-test')
import agent


class TcpHealthTests(unittest.TestCase):
    def test_non_http_listener_is_healthy_without_image_clients(self):
        """Vérifie la santé d’un port non HTTP sans client dans l’image."""
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            def connector(_address, timeout):
                """Simule une connexion TCP pour ce scénario."""
                return socket.create_connection(listener.getsockname(), timeout)
            result = agent.run_tcp_probe('20.1.2.3', '9090', connector=connector)
            self.assertTrue(result[0])
            self.assertEqual(result[2], 'tcp')

    def test_closed_port_retries_and_fails(self):
        """Vérifie les relances puis l’échec lorsque le port reste fermé."""
        calls = []
        def connector(address, timeout):
            """Simule une connexion TCP pour ce scénario."""
            calls.append(address)
            raise ConnectionRefusedError()
        result = agent.run_tcp_probe('20.1.2.3', '9090', attempts=2,
                                     sleeper=lambda _: None, connector=connector)
        self.assertFalse(result[0])
        self.assertEqual(result[3:], ('HEALTH_PORT_NOT_RESPONDING', 2))
        self.assertEqual(len(calls), 2)

    def test_missing_or_private_address_is_not_probed(self):
        """Vérifie qu’une adresse absente ou privée n’est pas sondée."""
        for address in (None, '', 'localhost', '127.0.0.1', '169.254.169.254', '10.0.0.1'):
            with self.subTest(address=address):
                result = agent.run_tcp_probe(address, '9090', connector=lambda *_: self.fail())
                self.assertEqual(result[3], 'HEALTH_PROBE_UNAVAILABLE')


if __name__ == '__main__':
    unittest.main()
