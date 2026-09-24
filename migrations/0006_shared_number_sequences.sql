-- Preserve existing sequence progress when switching from per-template codes to shared formats.
INSERT INTO document_sequences (document_type,year,last_value)
SELECT t.number_prefix,s.year,SUM(s.last_value)
FROM document_sequences s JOIN templates t ON t.code=s.document_type
GROUP BY t.number_prefix,s.year
ON CONFLICT(document_type,year) DO UPDATE SET last_value=MAX(document_sequences.last_value,excluded.last_value);
