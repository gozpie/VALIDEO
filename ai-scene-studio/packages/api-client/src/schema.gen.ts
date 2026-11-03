/**
 * Fichier généré depuis openapi.json par « pnpm api:generate ». Ne pas modifier à la main.
 */

export interface paths {
    "/ai/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Providers */
        get: operations["list_providers_ai_providers_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{asset_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Asset */
        get: operations["get_asset_assets__asset_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{asset_id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Asset Content */
        get: operations["get_asset_content_assets__asset_id__content_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: operations["login_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout */
        post: operations["logout_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Session */
        get: operations["get_session_auth_session_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/generation-jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Generation */
        get: operations["get_generation_generation_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/generation-jobs/{job_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Generation */
        post: operations["cancel_generation_generation_jobs__job_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Live */
        get: operations["live_health_live_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Ready */
        get: operations["ready_health_ready_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preview Invitation */
        get: operations["preview_invitation_invitations__token__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/{token}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Accept Invitation */
        post: operations["accept_invitation_invitations__token__accept_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Project */
        get: operations["get_project_projects__project_id__get"];
        put?: never;
        post?: never;
        /** Delete Project */
        delete: operations["delete_project_projects__project_id__delete"];
        options?: never;
        head?: never;
        /** Update Project */
        patch: operations["update_project_projects__project_id__patch"];
        trace?: never;
    };
    "/projects/{project_id}/sequences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Sequences */
        get: operations["list_sequences_projects__project_id__sequences_get"];
        put?: never;
        /** Create Sequence */
        post: operations["create_sequence_projects__project_id__sequences_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_id}/sequences/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Reorder Sequences */
        put: operations["reorder_sequences_projects__project_id__sequences_order_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/render-jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Render */
        get: operations["get_render_render_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/render-jobs/{job_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Render */
        post: operations["cancel_render_render_jobs__job_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scene-revisions/{revision_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Revision */
        get: operations["get_revision_scene_revisions__revision_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sequences/{sequence_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Sequence */
        get: operations["get_sequence_sequences__sequence_id__get"];
        put?: never;
        post?: never;
        /** Delete Sequence */
        delete: operations["delete_sequence_sequences__sequence_id__delete"];
        options?: never;
        head?: never;
        /** Rename Sequence */
        patch: operations["rename_sequence_sequences__sequence_id__patch"];
        trace?: never;
    };
    "/sequences/{sequence_id}/shots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Shots */
        get: operations["list_shots_sequences__sequence_id__shots_get"];
        put?: never;
        /** Create Shot */
        post: operations["create_shot_sequences__sequence_id__shots_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sequences/{sequence_id}/shots/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Reorder Shots */
        put: operations["reorder_shots_sequences__sequence_id__shots_order_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shots/{shot_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Shot */
        get: operations["get_shot_shots__shot_id__get"];
        put?: never;
        post?: never;
        /** Delete Shot */
        delete: operations["delete_shot_shots__shot_id__delete"];
        options?: never;
        head?: never;
        /** Update Shot */
        patch: operations["update_shot_shots__shot_id__patch"];
        trace?: never;
    };
    "/shots/{shot_id}/generations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Generations */
        get: operations["list_generations_shots__shot_id__generations_get"];
        put?: never;
        /** Create Generation */
        post: operations["create_generation_shots__shot_id__generations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shots/{shot_id}/generations/estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Estimate Generation */
        post: operations["estimate_generation_shots__shot_id__generations_estimate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shots/{shot_id}/renders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Renders
         * @description Les 50 rendus les plus récents du plan.
         */
        get: operations["list_renders_shots__shot_id__renders_get"];
        put?: never;
        /** Create Render */
        post: operations["create_render_shots__shot_id__renders_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shots/{shot_id}/scene": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Scene */
        get: operations["get_scene_shots__shot_id__scene_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shots/{shot_id}/scene/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Revisions
         * @description Les 100 révisions les plus récentes, de la plus récente à la plus ancienne.
         */
        get: operations["list_revisions_shots__shot_id__scene_revisions_get"];
        put?: never;
        /** Save Revision */
        post: operations["save_revision_shots__shot_id__scene_revisions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Workspaces */
        get: operations["list_workspaces_workspaces_get"];
        put?: never;
        /** Create Workspace */
        post: operations["create_workspace_workspaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspace_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Workspace */
        get: operations["get_workspace_workspaces__workspace_id__get"];
        put?: never;
        post?: never;
        /** Delete Workspace */
        delete: operations["delete_workspace_workspaces__workspace_id__delete"];
        options?: never;
        head?: never;
        /** Rename Workspace */
        patch: operations["rename_workspace_workspaces__workspace_id__patch"];
        trace?: never;
    };
    "/workspaces/{workspace_id}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Assets */
        get: operations["list_assets_workspaces__workspace_id__assets_get"];
        put?: never;
        /** Upload Asset */
        post: operations["upload_asset_workspaces__workspace_id__assets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspace_id}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Invitations */
        get: operations["list_invitations_workspaces__workspace_id__invitations_get"];
        put?: never;
        /** Create Invitation */
        post: operations["create_invitation_workspaces__workspace_id__invitations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspace_id}/invitations/{invitation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke Invitation */
        delete: operations["revoke_invitation_workspaces__workspace_id__invitations__invitation_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspace_id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Members */
        get: operations["list_members_workspaces__workspace_id__members_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspaces/{workspace_id}/members/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Member */
        delete: operations["remove_member_workspaces__workspace_id__members__user_id__delete"];
        options?: never;
        head?: never;
        /** Change Role */
        patch: operations["change_role_workspaces__workspace_id__members__user_id__patch"];
        trace?: never;
    };
    "/workspaces/{workspace_id}/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Projects */
        get: operations["list_projects_workspaces__workspace_id__projects_get"];
        put?: never;
        /** Create Project */
        post: operations["create_project_workspaces__workspace_id__projects_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * AcceptIn
         * @description Champs requis seulement pour créer le compte (adresse encore inconnue).
         */
        AcceptIn: {
            /** Displayname */
            displayName?: string | null;
            /** Password */
            password?: string | null;
        };
        /** AssetOut */
        AssetOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Createdbyid */
            createdById: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Metadata */
            metadata: {
                [key: string]: unknown;
            };
            /** Mimetype */
            mimeType: string;
            /** Name */
            name: string;
            /** Sha256 */
            sha256: string;
            /** Sizebytes */
            sizeBytes: number;
            /**
             * Type
             * @enum {string}
             */
            type: "model" | "texture" | "hdri" | "image" | "video" | "reference" | "render" | "render_pass";
            /**
             * Workspaceid
             * Format: uuid
             */
            workspaceId: string;
        };
        /** Body_upload_asset_workspaces__workspace_id__assets_post */
        Body_upload_asset_workspaces__workspace_id__assets_post: {
            /**
             * File
             * @description Fichier GLB (glTF 2.0 binaire)
             */
            file: string;
            /** Name */
            name?: string | null;
        };
        /** CheckOut */
        CheckOut: {
            /** Detail */
            detail?: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "ok" | "error";
        };
        /** CreatedInvitationOut */
        CreatedInvitationOut: {
            /** Accepturl */
            acceptUrl: string;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Email */
            email: string;
            /**
             * Expiresat
             * Format: date-time
             */
            expiresAt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "editor" | "viewer";
            /** Token */
            token: string;
        };
        /** EstimateOut */
        EstimateOut: {
            /** Amount */
            amount: number;
            /** Available */
            available: boolean;
            /** Basis */
            basis: string;
            /** Mismatches */
            mismatches: components["schemas"]["MismatchOut"][];
            /** Paid */
            paid: boolean;
            /** Reason */
            reason: string;
            /** Unit */
            unit: string;
        };
        /**
         * Fps
         * @description Cadence rationnelle (ex. 24000/1001), entre 1 et 1000 images par seconde.
         */
        Fps: {
            /**
             * Denominator
             * @default 1
             */
            denominator?: number;
            /** Numerator */
            numerator: number;
        };
        /** GenerationIn */
        GenerationIn: {
            /** Aspectratio */
            aspectRatio?: string | null;
            /** Confirmedcost */
            confirmedCost?: number | null;
            /** Durationseconds */
            durationSeconds?: number | null;
            /**
             * Mode
             * @enum {string}
             */
            mode: "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video" | "prompt_from_scene" | "scene_from_text" | "image_analysis";
            /** Model */
            model: string;
            /**
             * Negativeprompt
             * @default
             */
            negativePrompt?: string;
            /** Options */
            options?: {
                [key: string]: boolean | number | string;
            };
            /**
             * Prompt
             * @default
             */
            prompt?: string;
            /** Provider */
            provider: string;
            /** Referenceassetids */
            referenceAssetIds?: string[];
            /** Revisionid */
            revisionId?: string | null;
            /** Sceneframes */
            sceneFrames?: number[];
            /** Seed */
            seed?: number | null;
        };
        /** GenerationJobOut */
        GenerationJobOut: {
            /** Actualcost */
            actualCost: number | null;
            /** Completedat */
            completedAt: string | null;
            /** Costunit */
            costUnit: string;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Createdbyid */
            createdById: string | null;
            /** Errordetails */
            errorDetails: string | null;
            /** Estimatedcost */
            estimatedCost: number | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Message */
            message: string;
            /** Mode */
            mode: string;
            /** Modelid */
            modelId: string;
            /** Outputs */
            outputs: {
                [key: string]: unknown;
            };
            /** Progress */
            progress: number;
            /** Provider */
            provider: string;
            /** Renderjobid */
            renderJobId: string | null;
            /** Request */
            request: {
                [key: string]: unknown;
            };
            /**
             * Scenerevisionid
             * Format: uuid
             */
            sceneRevisionId: string;
            /**
             * Shotid
             * Format: uuid
             */
            shotId: string;
            /**
             * Status
             * @enum {string}
             */
            status: "queued" | "preparing" | "running" | "processing" | "completed" | "failed" | "cancelled";
        };
        /** HealthOut */
        HealthOut: {
            /** Checks */
            checks: {
                [key: string]: components["schemas"]["CheckOut"];
            };
            /**
             * Status
             * @enum {string}
             */
            status: "ok" | "degraded" | "error";
            /** Version */
            version: string;
        };
        /** InvitationIn */
        InvitationIn: {
            /** Email */
            email: string;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "editor" | "viewer";
        };
        /** InvitationOut */
        InvitationOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Email */
            email: string;
            /**
             * Expiresat
             * Format: date-time
             */
            expiresAt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "editor" | "viewer";
        };
        /** InvitationPreviewOut */
        InvitationPreviewOut: {
            /** Accountexists */
            accountExists: boolean;
            /** Email */
            email: string;
            /**
             * Expiresat
             * Format: date-time
             */
            expiresAt: string;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "editor" | "viewer";
            /** Workspacename */
            workspaceName: string;
        };
        /** LoginIn */
        LoginIn: {
            /** Email */
            email: string;
            /** Password */
            password: string;
        };
        /** MemberOut */
        MemberOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Displayname */
            displayName: string;
            /** Email */
            email: string;
            /**
             * Role
             * @enum {string}
             */
            role: "owner" | "admin" | "editor" | "viewer";
            /**
             * Userid
             * Format: uuid
             */
            userId: string;
        };
        /** MemberRoleIn */
        MemberRoleIn: {
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "editor" | "viewer";
        };
        /** MismatchOut */
        MismatchOut: {
            /** Field */
            field: string;
            /** Message */
            message: string;
            /**
             * Severity
             * @enum {string}
             */
            severity: "blocking" | "ignored";
        };
        /** ModelOut */
        ModelOut: {
            /** Aspectratios */
            aspectRatios: string[];
            /** Controls */
            controls: string[];
            /** Durationsseconds */
            durationsSeconds: number[];
            /** Label */
            label: string;
            /** Maxreferenceimages */
            maxReferenceImages: number;
            /** Model */
            model: string;
            /** Modes */
            modes: string[];
            /** Notes */
            notes: string;
        };
        /** Page[AssetOut] */
        Page_AssetOut_: {
            /** Items */
            items: components["schemas"]["AssetOut"][];
            /** Nextcursor */
            nextCursor: string | null;
        };
        /** Page[ProjectOut] */
        Page_ProjectOut_: {
            /** Items */
            items: components["schemas"]["ProjectOut"][];
            /** Nextcursor */
            nextCursor: string | null;
        };
        /** Page[WorkspaceOut] */
        Page_WorkspaceOut_: {
            /** Items */
            items: components["schemas"]["WorkspaceOut"][];
            /** Nextcursor */
            nextCursor: string | null;
        };
        /** ProblemFieldError */
        ProblemFieldError: {
            /** Message */
            message: string;
            /** Path */
            path: string;
        };
        /**
         * ProblemOut
         * @description Forme documentée de toutes les erreurs (``application/problem+json``).
         */
        ProblemOut: {
            /** Detail */
            detail: string;
            /** Errors */
            errors?: components["schemas"]["ProblemFieldError"][] | null;
            /** Requestid */
            requestId: string;
            /** Status */
            status: number;
            /** Title */
            title: string;
            /** Type */
            type: string;
        };
        /** ProjectIn */
        ProjectIn: {
            /**
             * Colorspace
             * @default srgb
             * @enum {string}
             */
            colorSpace?: "srgb" | "rec709" | "acescg" | "linear_rec709";
            /**
             * Description
             * @default
             */
            description?: string;
            /**
             * @default {
             *       "numerator": 24,
             *       "denominator": 1
             *     }
             */
            fps?: components["schemas"]["Fps"];
            /** Name */
            name: string;
            /**
             * @default {
             *       "width": 1920,
             *       "height": 1080
             *     }
             */
            resolution?: components["schemas"]["Resolution"];
        };
        /** ProjectOut */
        ProjectOut: {
            /**
             * Colorspace
             * @enum {string}
             */
            colorSpace: "srgb" | "rec709" | "acescg" | "linear_rec709";
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Description */
            description: string;
            fps: components["schemas"]["Fps"];
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            resolution: components["schemas"]["Resolution"];
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
            /**
             * Workspaceid
             * Format: uuid
             */
            workspaceId: string;
        };
        /** ProjectPatch */
        ProjectPatch: {
            /** Colorspace */
            colorSpace?: ("srgb" | "rec709" | "acescg" | "linear_rec709") | null;
            /** Description */
            description?: string | null;
            fps?: components["schemas"]["Fps"] | null;
            /** Name */
            name?: string | null;
            resolution?: components["schemas"]["Resolution"] | null;
        };
        /** ProviderOut */
        ProviderOut: {
            /** Available */
            available: boolean;
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "official" | "subscription" | "bridge" | "simulation";
            /** Label */
            label: string;
            /** Models */
            models: components["schemas"]["ModelOut"][];
            /** Reason */
            reason: string;
        };
        /** RenderIn */
        RenderIn: {
            /**
             * Conditioningmaps
             * @default false
             */
            conditioningMaps?: boolean;
            /** Frameend */
            frameEnd?: number | null;
            /** Frames */
            frames?: number[] | null;
            /** Framestart */
            frameStart?: number | null;
            /** Passes */
            passes?: ("beauty" | "alpha" | "depth" | "normal" | "object_id" | "cryptomatte" | "motion_vector")[];
            /**
             * Resolutionpercent
             * @default 100
             */
            resolutionPercent?: number;
            /** Revisionid */
            revisionId?: string | null;
            /** Samples */
            samples?: number | null;
        };
        /** RenderJobOut */
        RenderJobOut: {
            /** Completedat */
            completedAt: string | null;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Createdbyid */
            createdById: string | null;
            /** Error */
            error: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Message */
            message: string;
            /** Outputs */
            outputs: {
                [key: string]: unknown;
            };
            /** Progress */
            progress: number;
            /**
             * Scenerevisionid
             * Format: uuid
             */
            sceneRevisionId: string;
            /** Settings */
            settings: {
                [key: string]: unknown;
            };
            /**
             * Shotid
             * Format: uuid
             */
            shotId: string;
            /** Startedat */
            startedAt: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "queued" | "preparing" | "running" | "processing" | "completed" | "failed" | "cancelled";
        };
        /** Resolution */
        Resolution: {
            /** Height */
            height: number;
            /** Width */
            width: number;
        };
        /** RevisionOut */
        RevisionOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Createdbyid */
            createdById: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Message */
            message: string;
            /** Parentrevisionid */
            parentRevisionId: string | null;
            /**
             * Sceneid
             * Format: uuid
             */
            sceneId: string;
            /** Schemaversion */
            schemaVersion: number;
            /** Sizebytes */
            sizeBytes: number;
            /** Snapshothash */
            snapshotHash: string;
        };
        /** RevisionWithSnapshotOut */
        RevisionWithSnapshotOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Createdbyid */
            createdById: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Message */
            message: string;
            /** Parentrevisionid */
            parentRevisionId: string | null;
            /**
             * Sceneid
             * Format: uuid
             */
            sceneId: string;
            /** Schemaversion */
            schemaVersion: number;
            /** Sizebytes */
            sizeBytes: number;
            /** Snapshot */
            snapshot: {
                [key: string]: unknown;
            };
            /** Snapshothash */
            snapshotHash: string;
        };
        /** SaveRevisionOut */
        SaveRevisionOut: {
            /** Created */
            created: boolean;
            revision: components["schemas"]["RevisionOut"];
        };
        /** SceneStateOut */
        SceneStateOut: {
            headRevision: components["schemas"]["RevisionOut"] | null;
            /** Sceneid */
            sceneId: string | null;
            /**
             * Shotid
             * Format: uuid
             */
            shotId: string;
            /** Snapshot */
            snapshot: {
                [key: string]: unknown;
            } | null;
        };
        /** SequenceIn */
        SequenceIn: {
            /** Name */
            name: string;
            /** Position */
            position?: number | null;
        };
        /** SequenceOrderIn */
        SequenceOrderIn: {
            /** Sequenceids */
            sequenceIds: string[];
        };
        /** SequenceOut */
        SequenceOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Orderindex */
            orderIndex: number;
            /**
             * Projectid
             * Format: uuid
             */
            projectId: string;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
        };
        /** SequencePatch */
        SequencePatch: {
            /** Name */
            name: string;
        };
        /** SessionOut */
        SessionOut: {
            /** Csrftoken */
            csrfToken: string;
            /**
             * Expiresat
             * Format: date-time
             */
            expiresAt: string;
            user: components["schemas"]["UserOut"];
        };
        /** ShotIn */
        ShotIn: {
            /** Durationframes */
            durationFrames: number;
            fps?: components["schemas"]["Fps"] | null;
            /** Name */
            name: string;
            /** Position */
            position?: number | null;
        };
        /** ShotOrderIn */
        ShotOrderIn: {
            /** Shotids */
            shotIds: string[];
        };
        /** ShotOut */
        ShotOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Durationframes */
            durationFrames: number;
            effectiveFps: components["schemas"]["Fps"];
            fps: components["schemas"]["Fps"] | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Orderindex */
            orderIndex: number;
            /**
             * Projectid
             * Format: uuid
             */
            projectId: string;
            /**
             * Sequenceid
             * Format: uuid
             */
            sequenceId: string;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
        };
        /**
         * ShotPatch
         * @description Champs absents inchangés ; ``fps: null`` revient à la cadence du projet.
         */
        ShotPatch: {
            /** Durationframes */
            durationFrames?: number | null;
            fps?: components["schemas"]["Fps"] | null;
            /** Name */
            name?: string | null;
        };
        /** UploadedAssetOut */
        UploadedAssetOut: {
            asset: components["schemas"]["AssetOut"];
            /** Created */
            created: boolean;
        };
        /** UserOut */
        UserOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Displayname */
            displayName: string;
            /** Email */
            email: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
        };
        /** WorkspaceIn */
        WorkspaceIn: {
            /** Name */
            name: string;
        };
        /** WorkspaceOut */
        WorkspaceOut: {
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /**
             * Ownerid
             * Format: uuid
             */
            ownerId: string;
            /**
             * Role
             * @enum {string}
             */
            role: "owner" | "admin" | "editor" | "viewer";
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    list_providers_ai_providers_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"][];
                };
            };
        };
    };
    get_asset_assets__asset_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                asset_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssetOut"];
                };
            };
        };
    };
    get_asset_content_assets__asset_id__content_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                asset_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Contenu binaire de l'asset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "model/gltf-binary": unknown;
                };
            };
        };
    };
    login_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
        };
    };
    logout_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_session_auth_session_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
        };
    };
    get_generation_generation_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobOut"];
                };
            };
        };
    };
    cancel_generation_generation_jobs__job_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobOut"];
                };
            };
        };
    };
    live_health_live_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
        };
    };
    ready_health_ready_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
        };
    };
    preview_invitation_invitations__token__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationPreviewOut"];
                };
            };
        };
    };
    accept_invitation_invitations__token__accept_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
        };
    };
    get_project_projects__project_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
        };
    };
    delete_project_projects__project_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    update_project_projects__project_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectPatch"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
        };
    };
    list_sequences_projects__project_id__sequences_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SequenceOut"][];
                };
            };
        };
    };
    create_sequence_projects__project_id__sequences_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SequenceIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SequenceOut"];
                };
            };
        };
    };
    reorder_sequences_projects__project_id__sequences_order_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                project_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SequenceOrderIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SequenceOut"][];
                };
            };
        };
    };
    get_render_render_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenderJobOut"];
                };
            };
        };
    };
    cancel_render_render_jobs__job_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenderJobOut"];
                };
            };
        };
    };
    get_revision_scene_revisions__revision_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                revision_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevisionWithSnapshotOut"];
                };
            };
        };
    };
    get_sequence_sequences__sequence_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sequence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SequenceOut"];
                };
            };
        };
    };
    delete_sequence_sequences__sequence_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sequence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    rename_sequence_sequences__sequence_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sequence_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SequencePatch"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SequenceOut"];
                };
            };
        };
    };
    list_shots_sequences__sequence_id__shots_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sequence_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShotOut"][];
                };
            };
        };
    };
    create_shot_sequences__sequence_id__shots_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sequence_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShotIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShotOut"];
                };
            };
        };
    };
    reorder_shots_sequences__sequence_id__shots_order_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sequence_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShotOrderIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShotOut"][];
                };
            };
        };
    };
    get_shot_shots__shot_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShotOut"];
                };
            };
        };
    };
    delete_shot_shots__shot_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    update_shot_shots__shot_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShotPatch"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShotOut"];
                };
            };
        };
    };
    list_generations_shots__shot_id__generations_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobOut"][];
                };
            };
        };
    };
    create_generation_shots__shot_id__generations_post: {
        parameters: {
            query?: never;
            header?: {
                "Idempotency-Key"?: string | null;
            };
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerationIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationJobOut"];
                };
            };
        };
    };
    estimate_generation_shots__shot_id__generations_estimate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerationIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EstimateOut"];
                };
            };
        };
    };
    list_renders_shots__shot_id__renders_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenderJobOut"][];
                };
            };
        };
    };
    create_render_shots__shot_id__renders_post: {
        parameters: {
            query?: never;
            header?: {
                "Idempotency-Key"?: string | null;
            };
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenderIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenderJobOut"];
                };
            };
        };
    };
    get_scene_shots__shot_id__scene_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SceneStateOut"];
                };
            };
        };
    };
    list_revisions_shots__shot_id__scene_revisions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevisionOut"][];
                };
            };
        };
    };
    save_revision_shots__shot_id__scene_revisions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                shot_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Baserevisionid */
                    baseRevisionId: string | null;
                    /**
                     * Message
                     * @default
                     */
                    message?: string;
                    /** Snapshot */
                    snapshot: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveRevisionOut"];
                };
            };
        };
    };
    list_workspaces_workspaces_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_WorkspaceOut_"];
                };
            };
        };
    };
    create_workspace_workspaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceOut"];
                };
            };
        };
    };
    get_workspace_workspaces__workspace_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceOut"];
                };
            };
        };
    };
    delete_workspace_workspaces__workspace_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    rename_workspace_workspaces__workspace_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceOut"];
                };
            };
        };
    };
    list_assets_workspaces__workspace_id__assets_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                type?: string | null;
            };
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AssetOut_"];
                };
            };
        };
    };
    upload_asset_workspaces__workspace_id__assets_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_asset_workspaces__workspace_id__assets_post"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadedAssetOut"];
                };
            };
        };
    };
    list_invitations_workspaces__workspace_id__invitations_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationOut"][];
                };
            };
        };
    };
    create_invitation_workspaces__workspace_id__invitations_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitationIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedInvitationOut"];
                };
            };
        };
    };
    revoke_invitation_workspaces__workspace_id__invitations__invitation_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                invitation_id: string;
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    list_members_workspaces__workspace_id__members_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"][];
                };
            };
        };
    };
    remove_member_workspaces__workspace_id__members__user_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    change_role_workspaces__workspace_id__members__user_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                user_id: string;
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberRoleIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberOut"];
                };
            };
        };
    };
    list_projects_workspaces__workspace_id__projects_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_ProjectOut_"];
                };
            };
        };
    };
    create_project_workspaces__workspace_id__projects_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectIn"];
            };
        };
        responses: {
            /** @description Erreur client (problem details) */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Erreur serveur (problem details) */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemOut"];
                };
            };
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectOut"];
                };
            };
        };
    };
}
