/**
 * Team Service
 * Core business logic for team management
 */

const { supabase, supabaseAdmin } = require('../supabaseClient');
const crypto = require('crypto');

// Tier-based member limits
const TIER_LIMITS = {
    'standard': 1,
    'plus': 2,
    'premium': 5,
    'free': 0
};

/**
 * Get maximum team members allowed for a subscription tier
 * @param {string} subscriptionTier - User's subscription tier
 * @returns {number} Maximum team members allowed
 */
function getMaxTeamMembers(subscriptionTier) {
    if (!subscriptionTier) return 0;
    const tier = subscriptionTier.toLowerCase();
    return TIER_LIMITS[tier] || 0;
}

/**
 * Check if user is a Pro subscriber
 * @param {string} userId - User ID
 * @returns {Promise<{isPro: boolean, tier: string|null, maxMembers: number}>}
 */
async function checkProStatus(userId) {
    try {
        console.log('[TeamService] Checking Pro status for userId:', userId);

        const { data: user, error } = await supabase
            .from('users')
            .select('is_pro, subscription_type')
            .eq('id', userId)
            .single();

        console.log('[TeamService] User data:', user, 'Error:', error);

        if (error || !user) {
            console.log('[TeamService] User not found or error occurred');
            return { isPro: false, tier: null, maxMembers: 0 };
        }

        const maxMembers = getMaxTeamMembers(user.subscription_type);
        const result = {
            isPro: user.is_pro === true,
            tier: user.subscription_type,
            maxMembers
        };

        console.log('[TeamService] Pro status result:', result);
        return result;
    } catch (err) {
        console.error('[TeamService] checkProStatus error:', err);
        return { isPro: false, tier: null, maxMembers: 0 };
    }
}

/**
 * Get or create team for a user
 * @param {string} userId - Owner's user ID
 * @returns {Promise<{success: boolean, team?: object, error?: string}>}
 */
async function getOrCreateTeam(userId) {
    try {
        // Check Pro status first
        const proStatus = await checkProStatus(userId);
        if (!proStatus.isPro) {
            return { success: false, error: 'User is not a Pro subscriber' };
        }

        // Check if team already exists
        const { data: existingTeam, error: fetchError } = await supabase
            .from('teams')
            .select('*')
            .eq('owner_id', userId)
            .single();

        if (existingTeam) {
            // Update max_members if tier changed
            if (existingTeam.max_members !== proStatus.maxMembers) {
                await supabase
                    .from('teams')
                    .update({ max_members: proStatus.maxMembers })
                    .eq('id', existingTeam.id);
                existingTeam.max_members = proStatus.maxMembers;
            }
            return { success: true, team: existingTeam };
        }

        // Create new team
        const { data: newTeam, error: createError } = await supabase
            .from('teams')
            .insert({
                owner_id: userId,
                max_members: proStatus.maxMembers
            })
            .select()
            .single();

        if (createError) {
            console.error('[TeamService] Create team error:', createError);
            return { success: false, error: 'Failed to create team' };
        }

        // Add owner as team member with 'owner' role
        await supabase
            .from('team_members')
            .insert({
                team_id: newTeam.id,
                user_id: userId,
                role: 'owner'
            });

        return { success: true, team: newTeam };
    } catch (err) {
        console.error('[TeamService] getOrCreateTeam error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get team by ID with members
 * @param {string} teamId - Team ID
 * @returns {Promise<{success: boolean, team?: object, error?: string}>}
 */
async function getTeamWithMembers(teamId) {
    try {
        const { data: team, error: teamError } = await supabase
            .from('teams')
            .select('*')
            .eq('id', teamId)
            .single();

        if (teamError || !team) {
            return { success: false, error: 'Team not found' };
        }

        // Get members with user info
        const { data: members, error: membersError } = await supabase
            .from('team_members')
            .select(`
                id,
                role,
                joined_at,
                user_id,
                users (
                    id,
                    email,
                    company_name,
                    created_at
                )
            `)
            .eq('team_id', teamId);

        // Get pending invitations
        const { data: invitations, error: invitationsError } = await supabase
            .from('team_invitations')
            .select('*')
            .eq('team_id', teamId)
            .eq('status', 'pending');

        return {
            success: true,
            team: {
                ...team,
                members: members || [],
                pendingInvitations: invitations || []
            }
        };
    } catch (err) {
        console.error('[TeamService] getTeamWithMembers error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's team (as owner or member)
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, team?: object, role?: string, error?: string}>}
 */
async function getUserTeam(userId) {
    try {
        // Check if user is a team owner
        const { data: ownedTeam } = await supabase
            .from('teams')
            .select('*')
            .eq('owner_id', userId)
            .single();

        if (ownedTeam) {
            const teamData = await getTeamWithMembers(ownedTeam.id);
            return { ...teamData, role: 'owner' };
        }

        // Check if user is a team member
        const { data: membership } = await supabase
            .from('team_members')
            .select(`
                role,
                team_id,
                teams (*)
            `)
            .eq('user_id', userId)
            .neq('role', 'owner')
            .single();

        if (membership && membership.teams) {
            const teamData = await getTeamWithMembers(membership.team_id);
            return { ...teamData, role: membership.role };
        }

        return { success: true, team: null, role: null };
    } catch (err) {
        console.error('[TeamService] getUserTeam error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Generate invitation token
 * @returns {string} Unique invitation token
 */
function generateInvitationToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Send team invitation
 * @param {string} ownerId - Team owner's user ID
 * @param {string} inviteeEmail - Email to invite
 * @returns {Promise<{success: boolean, invitation?: object, error?: string}>}
 */
async function sendInvitation(ownerId, inviteeEmail) {
    try {
        // Get or create team
        const teamResult = await getOrCreateTeam(ownerId);
        if (!teamResult.success) {
            return teamResult;
        }

        const team = teamResult.team;

        // Check if owner is trying to invite themselves
        const { data: owner } = await supabase
            .from('users')
            .select('email')
            .eq('id', ownerId)
            .single();

        if (owner && owner.email.toLowerCase() === inviteeEmail.toLowerCase()) {
            return { success: false, error: 'You cannot invite yourself' };
        }

        // Check if invitee has a Diress account (optional - can invite users without account)
        const { data: invitee } = await supabase
            .from('users')
            .select('id, email')
            .ilike('email', inviteeEmail)
            .single();

        // If user exists, check if already a team member
        if (invitee) {
            const { data: existingMember } = await supabase
                .from('team_members')
                .select('id')
                .eq('team_id', team.id)
                .eq('user_id', invitee.id)
                .single();

            if (existingMember) {
                return { success: false, error: 'User is already a team member' };
            }

            // Check if user is already in another team
            const { data: otherMembership } = await supabase
                .from('team_members')
                .select('id')
                .eq('user_id', invitee.id)
                .single();

            if (otherMembership) {
                return { success: false, error: 'User is already a member of another team' };
            }
        }

        // Check team member limit (excluding owner)
        const { data: currentMembers } = await supabase
            .from('team_members')
            .select('id')
            .eq('team_id', team.id)
            .neq('role', 'owner');

        const currentCount = currentMembers ? currentMembers.length : 0;
        if (currentCount >= team.max_members) {
            return { success: false, error: `Team member limit reached (${team.max_members})` };
        }

        // Check for pending invitation to same email
        const { data: existingInvitation } = await supabase
            .from('team_invitations')
            .select('id')
            .eq('team_id', team.id)
            .ilike('invited_email', inviteeEmail)
            .eq('status', 'pending')
            .single();

        if (existingInvitation) {
            return { success: false, error: 'An invitation is already pending for this email' };
        }

        // Create invitation
        const token = generateInvitationToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

        const { data: invitation, error: inviteError } = await supabase
            .from('team_invitations')
            .insert({
                team_id: team.id,
                invited_email: inviteeEmail.toLowerCase(),
                invited_by: ownerId,
                token,
                status: 'pending',
                expires_at: expiresAt.toISOString()
            })
            .select()
            .single();

        if (inviteError) {
            console.error('[TeamService] Create invitation error:', inviteError);
            return { success: false, error: 'Failed to create invitation' };
        }

        return { success: true, invitation, inviteeId: invitee?.id || null, hasAccount: !!invitee };
    } catch (err) {
        console.error('[TeamService] sendInvitation error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Accept team invitation
 * @param {string} token - Invitation token
 * @param {string} userId - User accepting the invitation
 * @returns {Promise<{success: boolean, team?: object, error?: string}>}
 */
async function acceptInvitation(token, userId) {
    try {
        // Get invitation
        const { data: invitation, error: inviteError } = await supabase
            .from('team_invitations')
            .select('*, teams (*)')
            .eq('token', token)
            .eq('status', 'pending')
            .single();

        if (inviteError || !invitation) {
            return { success: false, error: 'Invalid or expired invitation' };
        }

        // Check expiration
        if (new Date(invitation.expires_at) < new Date()) {
            await supabase
                .from('team_invitations')
                .update({ status: 'expired' })
                .eq('id', invitation.id);
            return { success: false, error: 'Invitation has expired' };
        }

        // Verify user email matches invitation
        const { data: user } = await supabase
            .from('users')
            .select('email')
            .eq('id', userId)
            .single();

        if (!user || user.email.toLowerCase() !== invitation.invited_email.toLowerCase()) {
            return { success: false, error: 'This invitation is for a different email address' };
        }

        // Check if user is already in a team
        const { data: existingMembership } = await supabase
            .from('team_members')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (existingMembership) {
            return { success: false, error: 'You are already a member of a team' };
        }

        // Add user to team
        const { error: memberError } = await supabase
            .from('team_members')
            .insert({
                team_id: invitation.team_id,
                user_id: userId,
                role: 'member'
            });

        if (memberError) {
            console.error('[TeamService] Add member error:', memberError);
            return { success: false, error: 'Failed to join team' };
        }

        // Update invitation status
        await supabase
            .from('team_invitations')
            .update({
                status: 'accepted',
                responded_at: new Date().toISOString()
            })
            .eq('id', invitation.id);

        // Set user's active_team_id to the new team
        await supabase
            .from('users')
            .update({ active_team_id: invitation.team_id })
            .eq('id', userId);

        return { success: true, team: invitation.teams };
    } catch (err) {
        console.error('[TeamService] acceptInvitation error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Accept invitation by email (for newly registered users)
 * @param {string} token - Invitation token
 * @param {string} email - User's email
 * @returns {Promise<{success: boolean, team?: object, error?: string}>}
 */
async function acceptInvitationByEmail(token, email) {
    try {
        // Get invitation
        const { data: invitation, error: inviteError } = await supabase
            .from('team_invitations')
            .select('*, teams (*)')
            .eq('token', token)
            .eq('status', 'pending')
            .single();

        if (inviteError || !invitation) {
            return { success: false, error: 'Invalid or expired invitation' };
        }

        // Check expiration
        if (new Date(invitation.expires_at) < new Date()) {
            await supabase
                .from('team_invitations')
                .update({ status: 'expired' })
                .eq('id', invitation.id);
            return { success: false, error: 'Invitation has expired' };
        }

        // Verify email matches invitation
        if (email.toLowerCase() !== invitation.invited_email.toLowerCase()) {
            return { success: false, error: 'This invitation is for a different email address' };
        }

        // Get user by email
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .ilike('email', email)
            .single();

        if (!user) {
            return { success: false, error: 'User account not found' };
        }

        // Check if user is already in a team
        const { data: existingMembership } = await supabase
            .from('team_members')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (existingMembership) {
            return { success: false, error: 'You are already a member of a team' };
        }

        // Add user to team
        const { error: memberError } = await supabase
            .from('team_members')
            .insert({
                team_id: invitation.team_id,
                user_id: user.id,
                role: 'member'
            });

        if (memberError) {
            console.error('[TeamService] Add member error:', memberError);
            return { success: false, error: 'Failed to join team' };
        }

        // Update invitation status
        await supabase
            .from('team_invitations')
            .update({
                status: 'accepted',
                responded_at: new Date().toISOString()
            })
            .eq('id', invitation.id);

        // Set user's active_team_id to the new team
        await supabase
            .from('users')
            .update({ active_team_id: invitation.team_id })
            .eq('id', user.id);

        return { success: true, team: invitation.teams, userId: user.id };
    } catch (err) {
        console.error('[TeamService] acceptInvitationByEmail error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Decline team invitation
 * @param {string} token - Invitation token
 * @param {string} userId - User declining the invitation
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function declineInvitation(token, userId) {
    try {
        // Get invitation
        const { data: invitation } = await supabase
            .from('team_invitations')
            .select('*')
            .eq('token', token)
            .eq('status', 'pending')
            .single();

        if (!invitation) {
            return { success: false, error: 'Invalid or expired invitation' };
        }

        // Verify user email matches invitation
        const { data: user } = await supabase
            .from('users')
            .select('email')
            .eq('id', userId)
            .single();

        if (!user || user.email.toLowerCase() !== invitation.invited_email.toLowerCase()) {
            return { success: false, error: 'This invitation is for a different email address' };
        }

        // Update invitation status
        await supabase
            .from('team_invitations')
            .update({
                status: 'declined',
                responded_at: new Date().toISOString()
            })
            .eq('id', invitation.id);

        return { success: true };
    } catch (err) {
        console.error('[TeamService] declineInvitation error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Cancel invitation (by team owner)
 * @param {string} invitationId - Invitation ID
 * @param {string} ownerId - Team owner's user ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function cancelInvitation(invitationId, ownerId) {
    try {
        // Get invitation and verify ownership
        const { data: invitation } = await supabase
            .from('team_invitations')
            .select('*, teams (*)')
            .eq('id', invitationId)
            .eq('status', 'pending')
            .single();

        if (!invitation) {
            return { success: false, error: 'Invitation not found' };
        }

        if (invitation.teams.owner_id !== ownerId) {
            return { success: false, error: 'Only team owner can cancel invitations' };
        }

        // Delete invitation
        await supabase
            .from('team_invitations')
            .delete()
            .eq('id', invitationId);

        return { success: true };
    } catch (err) {
        console.error('[TeamService] cancelInvitation error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Remove team member
 * @param {string} teamId - Team ID
 * @param {string} memberId - Member's user ID to remove
 * @param {string} requesterId - User making the request
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function removeMember(teamId, memberId, requesterId) {
    try {
        // Get team
        const { data: team } = await supabase
            .from('teams')
            .select('owner_id')
            .eq('id', teamId)
            .single();

        if (!team) {
            return { success: false, error: 'Team not found' };
        }

        // Verify requester is owner
        if (team.owner_id !== requesterId) {
            return { success: false, error: 'Only team owner can remove members' };
        }

        // Cannot remove owner
        if (memberId === team.owner_id) {
            return { success: false, error: 'Cannot remove team owner' };
        }

        // Remove member
        const { error: deleteError } = await supabase
            .from('team_members')
            .delete()
            .eq('team_id', teamId)
            .eq('user_id', memberId);

        if (deleteError) {
            return { success: false, error: 'Failed to remove member' };
        }

        // Clear member's active_team_id
        await supabase
            .from('users')
            .update({ active_team_id: null })
            .eq('id', memberId);

        return { success: true };
    } catch (err) {
        console.error('[TeamService] removeMember error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Leave team (member action)
 * @param {string} userId - User leaving the team
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function leaveTeam(userId) {
    try {
        // Get membership
        const { data: membership } = await supabase
            .from('team_members')
            .select('*, teams (*)')
            .eq('user_id', userId)
            .single();

        if (!membership) {
            return { success: false, error: 'You are not a member of any team' };
        }

        // Cannot leave if owner
        if (membership.role === 'owner') {
            return { success: false, error: 'Team owner cannot leave. Delete the team instead.' };
        }

        // Remove membership
        await supabase
            .from('team_members')
            .delete()
            .eq('user_id', userId);

        // Clear active_team_id
        await supabase
            .from('users')
            .update({ active_team_id: null })
            .eq('id', userId);

        return { success: true };
    } catch (err) {
        console.error('[TeamService] leaveTeam error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get pending invitations for a user
 * @param {string} userEmail - User's email
 * @returns {Promise<{success: boolean, invitations?: array, error?: string}>}
 */
async function getPendingInvitations(userEmail) {
    try {
        const { data: invitations, error } = await supabase
            .from('team_invitations')
            .select(`
                *,
                teams (
                    id,
                    name,
                    owner_id,
                    users:owner_id (
                        email,
                        company_name
                    )
                )
            `)
            .ilike('invited_email', userEmail)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString());

        if (error) {
            console.error('[TeamService] getPendingInvitations error:', error);
            return { success: false, error: 'Failed to fetch invitations' };
        }

        return { success: true, invitations: invitations || [] };
    } catch (err) {
        console.error('[TeamService] getPendingInvitations error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get effective credits for a user (considering team membership)
 * @param {string} userId - User ID
 * @returns {Promise<{creditBalance: number, creditOwnerId: string, isTeamCredit: boolean}>}
 */
async function getEffectiveCredits(userId) {
    try {
        // Get user with active_team_id
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('credit_balance, active_team_id')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return {
                creditBalance: 0,
                creditOwnerId: userId,
                isTeamCredit: false
            };
        }

        // If user has active team, use owner's credits
        if (user.active_team_id) {
            const { data: team } = await supabase
                .from('teams')
                .select('owner_id')
                .eq('id', user.active_team_id)
                .single();

            if (team) {
                const { data: owner } = await supabase
                    .from('users')
                    .select('credit_balance')
                    .eq('id', team.owner_id)
                    .single();

                if (owner) {
                    return {
                        creditBalance: owner.credit_balance,
                        creditOwnerId: team.owner_id,
                        isTeamCredit: true
                    };
                }
            }
        }

        // Use own credits
        return {
            creditBalance: user.credit_balance,
            creditOwnerId: userId,
            isTeamCredit: false
        };
    } catch (err) {
        console.error('[TeamService] getEffectiveCredits error:', err);
        return {
            creditBalance: 0,
            creditOwnerId: userId,
            isTeamCredit: false
        };
    }
}

/**
 * Deduct credits from appropriate account (user or team owner)
 * @param {string} userId - User ID making the request
 * @param {number} amount - Amount to deduct
 * @returns {Promise<{success: boolean, newBalance?: number, error?: string}>}
 */
async function deductCredits(userId, amount) {
    try {
        const { creditOwnerId } = await getEffectiveCredits(userId);

        const { data, error } = await supabase
            .rpc('deduct_credits', {
                user_id: creditOwnerId,
                amount: amount
            });

        if (error) {
            // Fallback to direct update if RPC doesn't exist
            const { data: updated, error: updateError } = await supabase
                .from('users')
                .update({
                    credit_balance: supabase.raw(`credit_balance - ${amount}`)
                })
                .eq('id', creditOwnerId)
                .select('credit_balance')
                .single();

            if (updateError) {
                return { success: false, error: 'Failed to deduct credits' };
            }

            return { success: true, newBalance: updated.credit_balance };
        }

        return { success: true, newBalance: data };
    } catch (err) {
        console.error('[TeamService] deductCredits error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Switch active team (use own credits or team credits)
 * @param {string} userId - User ID
 * @param {string|null} teamId - Team ID to switch to, or null for own credits
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function switchActiveTeam(userId, teamId) {
    try {
        if (teamId) {
            // Verify user is a member of this team
            const { data: membership } = await supabase
                .from('team_members')
                .select('id')
                .eq('team_id', teamId)
                .eq('user_id', userId)
                .single();

            if (!membership) {
                return { success: false, error: 'You are not a member of this team' };
            }
        }

        const { error } = await supabase
            .from('users')
            .update({ active_team_id: teamId })
            .eq('id', userId);

        if (error) {
            return { success: false, error: 'Failed to switch team' };
        }

        return { success: true };
    } catch (err) {
        console.error('[TeamService] switchActiveTeam error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Delete team (owner action)
 * @param {string} teamId - Team ID
 * @param {string} ownerId - Owner's user ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteTeam(teamId, ownerId) {
    try {
        // Verify ownership
        const { data: team } = await supabase
            .from('teams')
            .select('owner_id')
            .eq('id', teamId)
            .single();

        if (!team) {
            return { success: false, error: 'Team not found' };
        }

        if (team.owner_id !== ownerId) {
            return { success: false, error: 'Only team owner can delete the team' };
        }

        // Clear active_team_id for all members
        await supabase
            .from('users')
            .update({ active_team_id: null })
            .eq('active_team_id', teamId);

        // Delete team (cascades to members and invitations)
        await supabase
            .from('teams')
            .delete()
            .eq('id', teamId);

        return { success: true };
    } catch (err) {
        console.error('[TeamService] deleteTeam error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Validate invitation token
 * @param {string} token - Invitation token
 * @returns {Promise<{valid: boolean, invitation?: object, error?: string}>}
 */
async function validateInvitationToken(token) {
    try {
        const { data: invitation, error } = await supabase
            .from('team_invitations')
            .select(`
                *,
                teams (
                    id,
                    name,
                    owner_id
                )
            `)
            .eq('token', token)
            .eq('status', 'pending')
            .single();

        if (error || !invitation) {
            return { valid: false, error: 'Invalid invitation token' };
        }

        if (new Date(invitation.expires_at) < new Date()) {
            return { valid: false, error: 'Invitation has expired' };
        }

        // Get inviter info
        const { data: inviter } = await supabase
            .from('users')
            .select('email, company_name')
            .eq('id', invitation.invited_by)
            .single();

        return {
            valid: true,
            invitation: {
                ...invitation,
                inviter
            }
        };
    } catch (err) {
        console.error('[TeamService] validateInvitationToken error:', err);
        return { valid: false, error: err.message };
    }
}

module.exports = {
    getMaxTeamMembers,
    checkProStatus,
    getOrCreateTeam,
    getTeamWithMembers,
    getUserTeam,
    sendInvitation,
    acceptInvitation,
    acceptInvitationByEmail,
    declineInvitation,
    cancelInvitation,
    removeMember,
    leaveTeam,
    getPendingInvitations,
    getEffectiveCredits,
    deductCredits,
    switchActiveTeam,
    deleteTeam,
    validateInvitationToken,
    TIER_LIMITS
};
