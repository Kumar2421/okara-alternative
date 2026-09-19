  db.prepare(
    `INSERT INTO findings
      (id, project_id, source, category, severity, entity_type, entity_id, url, evidence, recommendation, status, first_seen, last_seen, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, source, category, entity_type, entity_id, url) DO UPDATE SET
       severity = excluded.severity, evidence = excluded.evidence,
       recommendation = excluded.recommendation, status = excluded.status, resolved_at = excluded.resolved_at, last_seen = excluded.last_seen`
  ).run(
    id, input.projectId, input.source, input.category, input.severity, input.entityType,
    input.entityId, input.url ?? null, JSON.stringify(input.evidence), input.recommendation,
    nextStatus, existing?.first_seen ?? now, now, null
  );

  return mapFinding(db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as FindingRow);
}