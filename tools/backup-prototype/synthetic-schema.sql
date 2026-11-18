BEGIN;

CREATE TABLE public.users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE public.channels (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    handle text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE public.videos (
    id uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES public.channels(id),
    title text NOT NULL,
    status text NOT NULL CHECK (status IN ('PROCESSING', 'READY')),
    created_at timestamptz NOT NULL
);

CREATE TABLE public.video_variants (
    id uuid PRIMARY KEY,
    video_id uuid NOT NULL REFERENCES public.videos(id),
    resolution text NOT NULL,
    bitrate integer NOT NULL CHECK (bitrate > 0),
    playlist_key text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (video_id, resolution)
);

INSERT INTO public.users (id, email, display_name, created_at) VALUES
    ('10000000-0000-4000-8000-000000000001', 'ari@example.invalid', 'Ari Example', '2026-01-02T03:04:05Z'),
    ('10000000-0000-4000-8000-000000000002', 'bea@example.invalid', 'Bea Example', '2026-01-03T03:04:05Z');

INSERT INTO public.channels (id, user_id, handle, name, created_at) VALUES
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ari-demo', 'Ari Demo Channel', '2026-01-04T03:04:05Z'),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'bea-demo', 'Bea Demo Channel', '2026-01-05T03:04:05Z');

INSERT INTO public.videos (id, channel_id, title, status, created_at) VALUES
    ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Synthetic Sunrise', 'READY', '2026-01-06T03:04:05Z'),
    ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Synthetic River', 'PROCESSING', '2026-01-07T03:04:05Z'),
    ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Synthetic Clouds', 'READY', '2026-01-08T03:04:05Z');

INSERT INTO public.video_variants (id, video_id, resolution, bitrate, playlist_key, created_at) VALUES
    ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '360p', 600000, 'demo/1/360p.m3u8', '2026-01-09T03:04:05Z'),
    ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '720p', 2000000, 'demo/1/720p.m3u8', '2026-01-09T03:05:05Z'),
    ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '360p', 600000, 'demo/2/360p.m3u8', '2026-01-10T03:04:05Z'),
    ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', '720p', 2000000, 'demo/2/720p.m3u8', '2026-01-10T03:05:05Z'),
    ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000003', '360p', 600000, 'demo/3/360p.m3u8', '2026-01-11T03:04:05Z'),
    ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000003', '720p', 2000000, 'demo/3/720p.m3u8', '2026-01-11T03:05:05Z');

COMMIT;