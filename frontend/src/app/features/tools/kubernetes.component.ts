import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-kubernetes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kubernetes.component.html',
  styleUrls: ['./kubernetes.component.scss'],
})
export class KubernetesComponent {
  pods = [
    { name: 'frontend-5ffd87d65c', status: 'Running', meta: 'Angular · :30002' },
    { name: 'backend-684bd59c9', status: 'Running', meta: 'NestJS · :30001' },
    { name: 'app-test-678b5bff5d', status: 'Running', meta: 'Spring Boot · main-132 · :30003' },
    { name: 'postgres-0', status: 'Running', meta: 'StatefulSet · ClusterIP :5432' },
  ];
  services = [
    { name: 'frontend', type: 'NodePort', port: ':30002 → 80' },
    { name: 'backend', type: 'NodePort', port: ':30001 → 3000' },
    { name: 'app-test', type: 'NodePort', port: ':30003 → 8080' },
    { name: 'postgres', type: 'ClusterIP', port: ':5432 (interne)' },
  ];
  events = [
    { color: 'var(--accent-green)', text: 'app-test rollout completed — image main-132', meta: 'il y a 2h' },
    { color: 'var(--accent-orange)', text: 'app-test CrashLoopBackOff — DB_HOST pfe-postgres', meta: 'il y a 6h · Corrigé' },
    { color: 'var(--accent-green)', text: 'minikube restart après network conflict', meta: 'aujourd\'hui 11:30' },
  ];
  commands = [
    { desc: 'État des pods', cmd: 'kubectl get pods -n pfe-devsecops' },
    { desc: 'Logs app-test', cmd: 'kubectl logs -n pfe-devsecops -l app=app-test --tail=50' },
    { desc: 'Déployer nouvelle image', cmd: 'kubectl set image deployment/app-test app-test=souhaiel11/pfe-devsecops-2026:TAG -n pfe-devsecops' },
    { desc: 'Port-forward backend', cmd: 'kubectl port-forward svc/backend 3002:3000 -n pfe-devsecops' },
  ];
}
