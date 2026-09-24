UPDATE users
SET password_hash = 'e6aea852952683af5f4bc30af6d3cfc0e40df326b30f9929c04e1459dcb3043d',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('usr_admin', 'usr_issuer')
  AND password_salt = 'labdox-demo-salt';
