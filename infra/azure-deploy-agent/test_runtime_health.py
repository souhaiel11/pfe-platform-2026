"""Vérifie les preuves de santé du conteneur déployé."""
import os
import unittest

os.environ.setdefault('AZURE_DEPLOY_AGENT_SECRET', 'offline-test')
import agent


class FakeRunner:
    """Rejoue des sorties `az container exec` scriptées, dans l'ordre, et
    retient les commandes réellement soumises."""

    def __init__(self, outcomes):
        """Initialise les réponses et l’état de la simulation."""
        self.outcomes = list(outcomes)
        self.commands = []

    def __call__(self, argv, timeout=None):
        """Simule l’appel de commande et mémorise ses paramètres."""
        self.commands.append(argv[argv.index('--exec-command') + 1])
        return self.outcomes.pop(0) if self.outcomes else (True, '', '')


def never_sleeps(_seconds):
    """Interdit une attente réelle pendant le scénario de test."""
    pass


class HealthContractTests(unittest.TestCase):
    def test_no_declared_contract_probes_the_declared_port(self):
        """Vérifie que l’absence de contrat utilise le port déclaré."""
        plan = agent.health_contract({}, ['9090'])
        self.assertEqual(plan['mode'], 'GENERIC_TCP')
        self.assertEqual(plan['port'], '9090')
        self.assertEqual([p['prober'] for p in plan['probes']], ['curl', 'wget'])
        for probe in plan['probes']:
            self.assertIn('http://localhost:9090/', probe['command'])

    def test_generic_probe_guesses_no_application_route(self):
        """L'ancien défaut : /api/health deviné pour tout projet. Plus jamais."""
        for probe in agent.health_contract({}, ['8080'])['probes']:
            self.assertNotIn('/api/health', probe['command'])
            self.assertNotIn('health', probe['command'].split('http://localhost:8080/')[1])

    def test_generic_probe_commands_survive_aci_tokenisation(self):
        """`az container exec` tronçonne sur les espaces : aucune commande ne
        peut contenir de guillemet, de redirection ni de sous-commande."""
        for probe in agent.health_contract({}, ['8080'])['probes']:
            for forbidden in ('"', "'", '`', '$(', '&&', '||', ';', '|', '>', '<'):
                self.assertNotIn(forbidden, probe['command'], probe['command'])

    def test_declared_contract_is_honoured_exactly(self):
        """Vérifie que le contrat de santé déclaré est appliqué exactement."""
        plan = agent.health_contract({'healthCheck': {
            'path': '/api/auth/health', 'expectedBody': 'OK', 'client': 'wget'
        }}, ['8080'])
        self.assertEqual(plan['mode'], 'DECLARED_HTTP')
        self.assertEqual(len(plan['probes']), 1)
        probe = plan['probes'][0]
        self.assertEqual(probe['prober'], 'wget')
        self.assertEqual(probe['command'], 'wget -q -O - http://localhost:8080/api/auth/health')
        self.assertTrue(probe['match']('OK\n'))
        self.assertFalse(probe['match']('NOT_OK'))
        self.assertFalse(probe['match'](''))

    def test_untrusted_commands_and_destinations_rejected(self):
        """Vérifie le refus des commandes et destinations non autorisées."""
        for change in ({'path': '/health;id'}, {'path': '//evil.example'},
                       {'path': '/health?token=secret'}, {'client': 'sh'},
                       {'port': '9999'}, {'expectedBody': ''}, {'password': 'secret'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                agent.health_contract({'healthCheck': {
                    'path': '/health', 'expectedBody': 'OK', **change
                }}, ['8080'])

    def test_malformed_contract_rejected(self):
        """Vérifie le rejet d’un contrat de santé invalide."""
        for health in ([], '', 12):
            with self.assertRaises(ValueError):
                agent.health_contract({'healthCheck': health}, ['8080'])


class GenericProofTests(unittest.TestCase):
    def test_any_http_code_proves_the_port_answers(self):
        """Vérifie qu’une réponse HTTP prouve que le port répond."""
        for code in ('200', '404', '401', '503'):
            with self.subTest(code=code):
                self.assertTrue(agent._curl_proved_port(f'{agent.PROBE_MARKER}{code}'))

    def test_curl_000_is_a_closed_port_not_a_proof(self):
        """Vérifie que curl 000 ne constitue pas une preuve de santé."""
        self.assertFalse(agent._curl_proved_port(f'{agent.PROBE_MARKER}000'))

    def test_absent_marker_is_never_a_proof(self):
        """Vérifie qu’une sortie sans marqueur ne constitue pas une preuve."""
        for output in ('', '   ', 'sh: curl: not found', '200'):
            with self.subTest(output=output):
                self.assertFalse(agent._curl_proved_port(output))

    def test_wget_status_line_proves_the_port_answers(self):
        """Vérifie qu’un statut wget réel prouve la réponse du port."""
        probe = agent.health_contract({}, ['8080'])['probes'][1]
        self.assertTrue(probe['match']('  HTTP/1.1 404 Not Found'))
        self.assertFalse(probe['match']('wget: unable to resolve host address'))
        self.assertFalse(probe['match'](''))

    def test_a_missing_wget_never_counts_as_having_run(self):
        """« wget: » apparaît aussi dans « sh: wget: not found » : le détecteur
        ne doit se fier qu'aux diagnostics propres à wget en marche."""
        probe = agent.health_contract({}, ['8080'])['probes'][1]
        for absent in ('sh: wget: not found', '/bin/sh: 1: wget: not found',
                       'wget: command not found', 'bash: wget: command not found'):
            with self.subTest(absent=absent):
                self.assertFalse(probe['ran'](absent))
        for running in ('Connecting to localhost:8080', "wget: can't connect to remote host",
                        '  HTTP/1.1 200 OK'):
            with self.subTest(running=running):
                self.assertTrue(probe['ran'](running))


class RunHealthProbeTests(unittest.TestCase):
    def plan(self, target=None, ports=('8080',)):
        """Prépare un plan de sonde pour ce scénario."""
        return agent.health_contract(target or {}, list(ports))

    def test_proof_on_the_first_probe(self):
        """Vérifie la validation dès la première preuve positive."""
        runner = FakeRunner([(True, f'{agent.PROBE_MARKER}200', '')])
        ok, detail, prober, reason, used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), sleeper=never_sleeps)
        self.assertTrue(ok)
        self.assertEqual((prober, reason, used), ('curl', None, 1))
        self.assertIn('200', detail)
        self.assertEqual(len(runner.commands), 1, 'wget ne doit pas être tenté inutilement')

    def test_falls_back_to_wget_when_curl_is_absent(self):
        """Vérifie le repli vers wget lorsque curl est absent."""
        runner = FakeRunner([
            (True, '', 'sh: curl: not found'),
            (True, '', '  HTTP/1.1 404 Not Found'),
        ])
        ok, _detail, prober, reason, used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), sleeper=never_sleeps)
        self.assertTrue(ok)
        self.assertEqual((prober, reason, used), ('wget', None, 1))

    def test_retries_while_the_application_is_still_opening_its_port(self):
        """Vérifie les relances pendant le démarrage de l’application."""
        runner = FakeRunner([
            (True, f'{agent.PROBE_MARKER}000', ''),
            (True, '', 'wget: can\'t connect to remote host'),
            (True, f'{agent.PROBE_MARKER}200', ''),
        ])
        ok, _detail, prober, _reason, used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), sleeper=never_sleeps)
        self.assertTrue(ok)
        self.assertEqual((prober, used), ('curl', 2))

    def test_closed_port_is_distinguished_from_a_missing_client(self):
        """Distingue un port fermé d’un client de sonde absent."""
        runner = FakeRunner([(True, f'{agent.PROBE_MARKER}000', ''),
                             (True, '', 'wget: download timed out')] * 6)
        ok, _detail, prober, reason, used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), attempts=2, sleeper=never_sleeps)
        self.assertFalse(ok)
        self.assertIsNone(prober)
        self.assertEqual((reason, used), ('HEALTH_PORT_NOT_RESPONDING', 2))

    def test_no_usable_client_in_the_image_says_so(self):
        """Vérifie le diagnostic lorsqu’aucun client de sonde n’est utilisable."""
        runner = FakeRunner([(True, '', 'sh: curl: not found'),
                             (True, '', 'sh: wget: not found')] * 6)
        ok, _detail, _prober, reason, _used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), attempts=2, sleeper=never_sleeps)
        self.assertFalse(ok)
        self.assertEqual(reason, 'HEALTH_PROBE_UNAVAILABLE')

    def test_empty_output_never_counts_as_healthy(self):
        """Vérifie qu’une sortie vide ne prouve pas la santé."""
        runner = FakeRunner([(True, '', '')] * 12)
        ok, detail, _prober, reason, _used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), attempts=2, sleeper=never_sleeps)
        self.assertFalse(ok)
        self.assertIsNone(detail)
        self.assertEqual(reason, 'HEALTH_PROBE_UNAVAILABLE')

    def test_a_failed_exec_is_not_a_proof(self):
        """az sort en erreur : on ne lit surtout pas sa sortie comme une preuve."""
        runner = FakeRunner([(False, f'{agent.PROBE_MARKER}200', '')] * 12)
        ok, _detail, _prober, reason, _used = agent.run_health_probe(
            runner, 'rg', 'aci', self.plan(), attempts=2, sleeper=never_sleeps)
        self.assertFalse(ok)
        self.assertEqual(reason, 'HEALTH_PROBE_UNAVAILABLE')

    def test_declared_contract_failing_body_is_a_port_that_answered(self):
        """Distingue une réponse HTTP d’un corps conforme au contrat."""
        plan = self.plan({'healthCheck': {'path': '/health', 'expectedBody': 'OK'}})
        runner = FakeRunner([(True, 'DOWN', '')] * 6)
        ok, _detail, _prober, reason, _used = agent.run_health_probe(
            runner, 'rg', 'aci', plan, attempts=2, sleeper=never_sleeps)
        self.assertFalse(ok)
        self.assertEqual(reason, 'HEALTH_PORT_NOT_RESPONDING')


if __name__ == '__main__':
    unittest.main()
