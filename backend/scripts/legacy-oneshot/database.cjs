// Prépare l'accès PostgreSQL utilisé par les outils opérateur de réconciliation legacy.
'use strict';
const {DataSource, EntitySchema} = require('typeorm');
const {ManualRemediationTask} = require('../../src/manual-remediation/manual-remediation.entity');
const {Project} = require('../../src/projects/project.entity');
const {Incident} = require('../../src/incidents/incident.entity');
// Explicit read/update mapping avoids loading the application or unrelated providers.
// No schema synchronization, migrations, subscriptions, or application bootstrap.
const columns = {
  id:{type:'uuid',primary:true}, projectId:{type:'uuid'}, incidentId:{type:'uuid',nullable:true},
  findingId:{type:'text',nullable:true}, findingFingerprint:{type:'text'}, source:{type:'text'},
  ruleOrCve:{type:'text',nullable:true}, title:{type:'text'}, severity:{type:'text',nullable:true},
  remediationType:{type:'text',nullable:true}, findingSnapshot:{type:'jsonb'}, status:{type:'text'},
  scannerStatus:{type:'text'}, completedByUserId:{type:'text',nullable:true},
  completedByDisplayName:{type:'text',nullable:true}, completedAt:{type:'timestamp',nullable:true},
  completionNote:{type:'text',nullable:true}, lastSeenBuild:{type:'integer',nullable:true},
  verifiedBuild:{type:'integer',nullable:true}, verifiedAt:{type:'timestamp',nullable:true},
  events:{type:'jsonb'}, securityFindingRemediation:{type:'jsonb',nullable:true},
  securityRemediationBatchId:{type:'text',nullable:true}, createdAt:{type:'timestamp'},
  updatedAt:{type:'timestamp',updateDate:true},
};
/** Prépare l’accès à la base de données. */
function database(url) {
  return new DataSource({type:'postgres',url,synchronize:false,migrationsRun:false,logging:false,
    extra:{application_name:'chain2b-legacy-oneshot',statement_timeout:60000,lock_timeout:15000},
    entities:[
      new EntitySchema({name:'ManualRemediationTask',target:ManualRemediationTask,tableName:'manual_remediation_tasks',columns}),
      new EntitySchema({name:'Project',target:Project,tableName:'projects',columns:{id:{type:'uuid',primary:true},githubRepo:{type:'text'}}}),
      new EntitySchema({name:'Incident',target:Incident,tableName:'incidents',columns:{id:{type:'uuid',primary:true},projectId:{type:'uuid'},metadata:{type:'jsonb'},createdAt:{type:'timestamp'}}}),
    ]});
}
module.exports = {database};
