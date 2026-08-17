import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

// Garde anti-boucle du routage automatique WF4/WF5 (webhooks.service.ts::
// routeToOptimizer). Une ligne = un déclenchement OPTIMIZE réellement
// effectué. hash = sha256(projectId + type + errorReason) : contrairement
// à une simple comparaison avec le dernier incident (fragile — un aléa
// entre deux occurrences du même échec reset la comparaison), cette table
// se souvient de TOUT hash déjà routé, quel que soit ce qui s'est passé
// entre-temps (ex : les ~10 builds ZAP identiques de ce soir, entrecoupés
// d'autres tests). expiresAt (TTL) borne volontairement la mémoire : un
// même échec qui persiste des jours ne doit pas rester bloqué pour
// toujours si quelque chose a pu changer côté dépôt/infra entre-temps.
@Entity('routed_builds')
export class RoutedBuild {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  hash: string;

  @Column()
  projectId: string;

  // 'jenkinsfile' | 'dockerfile' — jamais autre chose, voir le garde-fou
  // dans routeToOptimizer (vulnerability/code/infra/unknown ne créent
  // jamais de ligne ici, ils ne routent jamais).
  @Column()
  classificationType: string;

  @Column({ type: 'text' })
  errorReason: string;

  @CreateDateColumn()
  routedAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
