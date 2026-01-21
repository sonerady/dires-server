/**
 * Team Routes
 * API endpoints for team management
 */

const express = require("express");
const { Resend } = require("resend");
const { supabase } = require("../supabaseClient");
const teamService = require("../services/teamService");
const { getTeamInvitationTemplate } = require("../lib/emailTemplates");

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const WEB_URL = process.env.WEB_URL || "https://app.diress.ai";

// ============================================
// Team Management
// ============================================

/**
 * GET /api/teams/my-team
 * Get user's team (as owner or member)
 */
router.get("/my-team", async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] Getting team for user: ${userId}`);
        const result = await teamService.getUserTeam(userId);

        if (!result.success) {
            return res.status(400).json(result);
        }

        // Get owner info if team exists
        if (result.team) {
            const { data: owner } = await supabase
                .from("users")
                .select("email, company_name, credit_balance")
                .eq("id", result.team.owner_id)
                .single();

            result.team.owner = owner;
        }

        res.json(result);
    } catch (err) {
        console.error("[Teams] Get team error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * DELETE /api/teams/:teamId
 * Delete team (owner only)
 */
router.delete("/:teamId", async (req, res) => {
    const { teamId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] Deleting team: ${teamId} by user: ${userId}`);
        const result = await teamService.deleteTeam(teamId, userId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Delete team error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

// ============================================
// Invitation Management
// ============================================

/**
 * POST /api/teams/invite
 * Send team invitation
 */
router.post("/invite", async (req, res) => {
    const { userId, email } = req.body;

    if (!userId || !email) {
        return res.status(400).json({
            success: false,
            error: "userId and email are required"
        });
    }

    try {
        console.log(`[Teams] Sending invitation from ${userId} to ${email}`);

        // Create invitation
        const result = await teamService.sendInvitation(userId, email);

        if (!result.success) {
            return res.status(400).json(result);
        }

        // Get inviter info for email
        const { data: inviter } = await supabase
            .from("users")
            .select("email, company_name, full_name")
            .eq("id", userId)
            .single();

        // Priority: full_name (Google auth) > email > company_name
        const inviterName = inviter?.full_name || inviter?.email || inviter?.company_name || "A Diress user";
        const inviterCompany = inviter?.company_name || null;

        // Generate URLs
        const token = result.invitation.token;
        const acceptUrl = `${WEB_URL}/team-invite?token=${token}&action=accept`;
        const declineUrl = `${WEB_URL}/team-invite?token=${token}&action=decline`;
        const signupUrl = `${WEB_URL}/login?invite_token=${token}&email=${encodeURIComponent(email)}`;

        // Send invitation email
        try {
            await resend.emails.send({
                from: "Diress <noreply@diress.ai>",
                to: email,
                subject: "You've been invited to join a team on Diress",
                html: getTeamInvitationTemplate(inviterName, inviterCompany, acceptUrl, declineUrl, signupUrl)
            });
            console.log(`[Teams] Invitation email sent to ${email}`);
        } catch (emailErr) {
            console.error("[Teams] Email send error:", emailErr);
            // Don't fail the request if email fails
        }

        res.json({
            success: true,
            invitation: result.invitation,
            message: "Invitation sent successfully"
        });
    } catch (err) {
        console.error("[Teams] Send invitation error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * GET /api/teams/invitations
 * Get owner's sent invitations
 */
router.get("/invitations", async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        // Get user's team
        const { data: team } = await supabase
            .from("teams")
            .select("id")
            .eq("owner_id", userId)
            .single();

        if (!team) {
            return res.json({
                success: true,
                invitations: []
            });
        }

        // Get invitations
        const { data: invitations } = await supabase
            .from("team_invitations")
            .select("*")
            .eq("team_id", team.id)
            .order("created_at", { ascending: false });

        res.json({
            success: true,
            invitations: invitations || []
        });
    } catch (err) {
        console.error("[Teams] Get invitations error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * DELETE /api/teams/invitations/:invitationId
 * Cancel invitation (owner only)
 */
router.delete("/invitations/:invitationId", async (req, res) => {
    const { invitationId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] Canceling invitation: ${invitationId} by user: ${userId}`);
        const result = await teamService.cancelInvitation(invitationId, userId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Cancel invitation error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * GET /api/teams/invitations/validate/:token
 * Validate invitation token (public endpoint)
 */
router.get("/invitations/validate/:token", async (req, res) => {
    const { token } = req.params;

    try {
        const result = await teamService.validateInvitationToken(token);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Validate token error:", err);
        res.status(500).json({
            valid: false,
            error: "Server error"
        });
    }
});

/**
 * POST /api/teams/invitations/:token/accept
 * Accept invitation
 */
router.post("/invitations/:token/accept", async (req, res) => {
    const { token } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] Accepting invitation with token for user: ${userId}`);
        const result = await teamService.acceptInvitation(token, userId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Accept invitation error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * POST /api/teams/invitations/:token/accept-by-email
 * Accept invitation by email (for newly registered users)
 * This endpoint is used when a user registers after receiving an invitation
 */
router.post("/invitations/:token/accept-by-email", async (req, res) => {
    const { token } = req.params;
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: "email is required"
        });
    }

    try {
        console.log(`[Teams] Accepting invitation by email: ${email}`);
        const result = await teamService.acceptInvitationByEmail(token, email);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Accept invitation by email error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * POST /api/teams/invitations/:token/decline
 * Decline invitation
 */
router.post("/invitations/:token/decline", async (req, res) => {
    const { token } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] Declining invitation with token for user: ${userId}`);
        const result = await teamService.declineInvitation(token, userId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Decline invitation error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * GET /api/teams/pending-invitations
 * Get user's pending invitations
 */
router.get("/pending-invitations", async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        // Get user email
        const { data: user } = await supabase
            .from("users")
            .select("email")
            .eq("id", userId)
            .single();

        if (!user) {
            return res.status(404).json({
                success: false,
                error: "User not found"
            });
        }

        const result = await teamService.getPendingInvitations(user.email);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Get pending invitations error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

// ============================================
// Member Management
// ============================================

/**
 * GET /api/teams/:teamId/members
 * Get team members
 */
router.get("/:teamId/members", async (req, res) => {
    const { teamId } = req.params;

    try {
        const result = await teamService.getTeamWithMembers(teamId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Get members error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * DELETE /api/teams/:teamId/members/:memberId
 * Remove team member (owner only)
 */
router.delete("/:teamId/members/:memberId", async (req, res) => {
    const { teamId, memberId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] Removing member ${memberId} from team ${teamId} by ${userId}`);
        const result = await teamService.removeMember(teamId, memberId, userId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Remove member error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * POST /api/teams/leave
 * Leave team (member action)
 */
router.post("/leave", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] User ${userId} leaving team`);
        const result = await teamService.leaveTeam(userId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Leave team error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * POST /api/teams/switch
 * Switch active team (use own credits or team credits)
 */
router.post("/switch", async (req, res) => {
    const { userId, teamId } = req.body;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        console.log(`[Teams] User ${userId} switching to team: ${teamId || "own credits"}`);
        const result = await teamService.switchActiveTeam(userId, teamId);
        res.json(result);
    } catch (err) {
        console.error("[Teams] Switch team error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

// ============================================
// Credit Management
// ============================================

/**
 * GET /api/teams/effective-credits
 * Get effective credits for user (considering team membership)
 */
router.get("/effective-credits", async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required"
        });
    }

    try {
        const credits = await teamService.getEffectiveCredits(userId);
        res.json({
            success: true,
            ...credits
        });
    } catch (err) {
        console.error("[Teams] Get effective credits error:", err);
        res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

/**
 * GET /api/teams/tier-limits
 * Get tier-based member limits
 */
router.get("/tier-limits", async (req, res) => {
    res.json({
        success: true,
        limits: teamService.TIER_LIMITS
    });
});

module.exports = router;
