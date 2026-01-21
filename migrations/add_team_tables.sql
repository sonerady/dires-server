-- Migration: Add team tables for team member feature
-- This migration creates teams, team_members, and team_invitations tables
-- Safe to run multiple times - checks if tables/columns exist before adding

-- ============================================
-- 1. Create teams table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'teams'
    ) THEN
        CREATE TABLE teams (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(255),
            max_members INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT unique_team_owner UNIQUE(owner_id)
        );

        -- Create index on owner_id for faster lookups
        CREATE INDEX idx_teams_owner_id ON teams(owner_id);

        RAISE NOTICE 'teams table created successfully';
    ELSE
        RAISE NOTICE 'teams table already exists, skipping...';
    END IF;
END $$;

COMMENT ON TABLE teams IS 'Stores team information for Pro users who can invite team members';
COMMENT ON COLUMN teams.owner_id IS 'The user who owns this team (Pro subscriber)';
COMMENT ON COLUMN teams.max_members IS 'Maximum number of members allowed based on subscription tier';

-- ============================================
-- 2. Create team_members table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'team_members'
    ) THEN
        CREATE TABLE team_members (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(50) DEFAULT 'member',
            joined_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT unique_team_member UNIQUE(team_id, user_id)
        );

        -- Create indexes for faster lookups
        CREATE INDEX idx_team_members_team_id ON team_members(team_id);
        CREATE INDEX idx_team_members_user_id ON team_members(user_id);

        RAISE NOTICE 'team_members table created successfully';
    ELSE
        RAISE NOTICE 'team_members table already exists, skipping...';
    END IF;
END $$;

COMMENT ON TABLE team_members IS 'Stores team membership relationships';
COMMENT ON COLUMN team_members.role IS 'Member role: owner or member';

-- ============================================
-- 3. Create team_invitations table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'team_invitations'
    ) THEN
        CREATE TABLE team_invitations (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            invited_email VARCHAR(255) NOT NULL,
            invited_by UUID NOT NULL REFERENCES users(id),
            token VARCHAR(255) NOT NULL UNIQUE,
            status VARCHAR(50) DEFAULT 'pending',
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            responded_at TIMESTAMP,
            CONSTRAINT unique_team_invitation UNIQUE(team_id, invited_email)
        );

        -- Create indexes for faster lookups
        CREATE INDEX idx_team_invitations_team_id ON team_invitations(team_id);
        CREATE INDEX idx_team_invitations_token ON team_invitations(token);
        CREATE INDEX idx_team_invitations_invited_email ON team_invitations(invited_email);
        CREATE INDEX idx_team_invitations_status ON team_invitations(status);

        RAISE NOTICE 'team_invitations table created successfully';
    ELSE
        RAISE NOTICE 'team_invitations table already exists, skipping...';
    END IF;
END $$;

COMMENT ON TABLE team_invitations IS 'Stores pending team invitations';
COMMENT ON COLUMN team_invitations.token IS 'Unique token for invitation verification';
COMMENT ON COLUMN team_invitations.status IS 'Invitation status: pending, accepted, declined, expired';
COMMENT ON COLUMN team_invitations.expires_at IS 'Invitation expiration time (7 days from creation)';

-- ============================================
-- 4. Add active_team_id column to users table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'active_team_id'
    ) THEN
        ALTER TABLE users ADD COLUMN active_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

        -- Create index for faster lookups
        CREATE INDEX idx_users_active_team_id ON users(active_team_id);

        RAISE NOTICE 'active_team_id column added to users table';
    ELSE
        RAISE NOTICE 'active_team_id column already exists in users table, skipping...';
    END IF;
END $$;

COMMENT ON COLUMN users.active_team_id IS 'The team whose credits this user is currently using (null = own credits)';

-- ============================================
-- 5. Create function to auto-update updated_at
-- ============================================
DO $$
BEGIN
    -- Create trigger function if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_teams_updated_at') THEN
        CREATE OR REPLACE FUNCTION update_teams_updated_at()
        RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;

        RAISE NOTICE 'update_teams_updated_at function created';
    END IF;
END $$;

-- Create trigger on teams table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'teams_updated_at_trigger'
    ) THEN
        CREATE TRIGGER teams_updated_at_trigger
            BEFORE UPDATE ON teams
            FOR EACH ROW
            EXECUTE FUNCTION update_teams_updated_at();

        RAISE NOTICE 'teams_updated_at_trigger created';
    ELSE
        RAISE NOTICE 'teams_updated_at_trigger already exists, skipping...';
    END IF;
END $$;

-- ============================================
-- 6. Create view for team statistics
-- ============================================
DO $$
BEGIN
    CREATE OR REPLACE VIEW team_statistics AS
    SELECT
        t.id as team_id,
        t.owner_id,
        t.name as team_name,
        t.max_members,
        COUNT(tm.id) as current_members,
        t.max_members - COUNT(tm.id) as available_slots,
        (SELECT COUNT(*) FROM team_invitations ti WHERE ti.team_id = t.id AND ti.status = 'pending') as pending_invitations,
        t.created_at,
        t.updated_at
    FROM teams t
    LEFT JOIN team_members tm ON t.id = tm.team_id
    GROUP BY t.id;

    RAISE NOTICE 'team_statistics view created/updated';
END $$;

COMMENT ON VIEW team_statistics IS 'Aggregated view of team membership statistics';
