BEGIN;

CREATE TABLE public."User" (
    email text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    id text NOT NULL,
    name text
);

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);

COMMIT;
