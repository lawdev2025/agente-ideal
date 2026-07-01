-- Reset de senhas: volta todos para "senha123" e OBRIGA a troca no próximo login
-- (must_change_password = TRUE). Rode no SQL Editor do Supabase.
--
-- Os hashes são scrypt (salt:hash em hex, KEYLEN=64) — mesmo formato de
-- src/auth/password.ts. Cada usuário tem um salt distinto. Idempotente.

UPDATE app_users SET
  password_hash = '615122efb27c92433d647b4d0af58b25:47f871962c6f9a52bf40cb7c78d9dfff0059fe82a091412e13ad4d35f59c3aee7d5b006431a02b37333f3300d31cac50f5896b9324b422f3659f30b24c77d33b',
  must_change_password = TRUE,
  updated_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE login = 'admin';

UPDATE app_users SET
  password_hash = '7dd09bdbb512f66c4771d1f90df72bc4:d8463259f8e3090499396c5c0f96bf0f9dd6451849e6a8c56c5de1b4a984ca3ec0fcf155efb79af6ffd975321d8215dee57046ea2e3faf49b601b7a22846d499',
  must_change_password = TRUE,
  updated_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE login = 'elizangela.cruz@grupoideal.com.br';

UPDATE app_users SET
  password_hash = 'e3b828af8f41d78d4cbf6407c9e5e72d:16ec8cff86923145f551201a3b8c11ed223a395df7fb5f326033254e16a0b01791329f38103463f942bae1276606dbb6711a15397d01d91726bf92b12bdb4ebe',
  must_change_password = TRUE,
  updated_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE login = 'ivane.furtado@grupoideal.com.br';

UPDATE app_users SET
  password_hash = '411ce98d734b97adb8745f841158a1be:b1ab13dbf9bef0086fa21df9b74f5ce39b3247af4b963d78b86706575f0e4d14cddbd2329957b783b7bb1e25115190043fbd13c883a70790bd311c8c5fdc795e',
  must_change_password = TRUE,
  updated_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE login = 'adriane.fernandes@grupoideal.com.br';
