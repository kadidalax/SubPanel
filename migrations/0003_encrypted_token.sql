-- store encrypted raw subscription token so links can be re-shown without rotate
ALTER TABLE subscriptions ADD COLUMN encrypted_token TEXT;
