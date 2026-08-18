-- Run ONCE after schema.sql: creates your team row.
-- CHANGE 'PICK-A-CODE' to the post code you'll share with teammates
-- (it gates all writes: score posting + availability answers).
insert into teams (id, name, post_code)
values ('slayers', 'Slayers', 'PICK-A-CODE')
on conflict (id) do nothing;
