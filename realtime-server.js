/**
 * ============================================================
 * HANVERSE REALTIME SERVER 🐼⚡
 * ============================================================
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;


/* ============================================================
   CONFIGURATION
============================================================ */

const PORT = Number(process.env.REALTIME_PORT || 3001);

const ALLOWED_ORIGINS = (
    process.env.ALLOWED_ORIGINS ||
    "https://hanverse.netlify.app,http://localhost:3000,http://localhost:8888"
)
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

const JWT_SECRET =
    process.env.JWT_SECRET ||
    process.env.JWT_SECRET_KEY ||
    null;

const DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    null;


/* ============================================================
   EXPRESS APP
============================================================ */

const app = express();

app.use(express.json());


/* ============================================================
   DATABASE
============================================================ */

let pool = null;

if (DATABASE_URL) {

    pool = new Pool({
        connectionString: DATABASE_URL,

        ssl: {
            rejectUnauthorized: false
        },

        max: 10,

        idleTimeoutMillis: 30000,

        connectionTimeoutMillis: 10000
    });

    pool.on("error", error => {
        console.error(
            "❌ Realtime database pool error:",
            error
        );
    });

    console.log("🗄️ Neon database connection configured.");

} else {

    console.warn(
        "⚠️ DATABASE_URL / NEON_DATABASE_URL is not configured."
    );

    console.warn(
        "⚠️ Leaderboard database queries will be disabled."
    );
}


/* ============================================================
   HTTP SERVER
============================================================ */

const httpServer = createServer(app);


/* ============================================================
   SOCKET.IO
============================================================ */

const io = new Server(httpServer, {

    cors: {

        origin: (origin, callback) => {

            if (!origin) {
                return callback(null, true);
            }

            if (ALLOWED_ORIGINS.includes(origin)) {
                return callback(null, true);
            }

            console.warn(
                `🚫 Socket.IO blocked origin: ${origin}`
            );

            return callback(
                new Error("Origin not allowed")
            );
        },

        methods: ["GET", "POST"],

        credentials: true
    },

    transports: [
        "websocket",
        "polling"
    ]
});


/* ============================================================
   HELPER — SAFE STRING
============================================================ */

function safeString(value, fallback = "") {

    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    return String(value).trim();
}


/* ============================================================
   JWT USER ID
============================================================ */

function extractUserId(token) {

    if (!token || !JWT_SECRET) {
        return null;
    }

    try {

        const decoded = jwt.verify(
            token,
            JWT_SECRET
        );

        return (
            decoded.user_id ||
            decoded.userId ||
            decoded.id ||
            decoded.sub ||
            null
        );

    } catch (error) {

        console.warn(
            "⚠️ Invalid realtime JWT:",
            error.message
        );

        return null;
    }
}


/* ============================================================
   SOCKET AUTHENTICATION
============================================================ */

io.use((socket, next) => {

    try {

        const auth =
            socket.handshake.auth || {};

        const token =
            auth.token ||
            auth.accessToken ||
            null;


        /*
         * If JWT is available, authenticate the socket.
         */

        if (token && JWT_SECRET) {

            const userId =
                extractUserId(token);

            if (!userId) {

                return next(
                    new Error(
                        "Invalid authentication token"
                    )
                );
            }

            socket.userId =
                String(userId);

            socket.authenticated =
                true;

        } else {

            /*
             * Development fallback.
             */

            socket.userId = null;

            socket.authenticated =
                false;
        }

        next();

    } catch (error) {

        console.error(
            "❌ Socket authentication error:",
            error
        );

        next(
            new Error(
                "Realtime authentication failed"
            )
        );
    }
});


/* ============================================================
   ACTIVE LEARNERS
============================================================ */

const connectedLearners = new Map();


/* ============================================================
   ROOM HELPERS
============================================================ */

function lessonRoom(lessonId) {

    return `lesson:${safeString(lessonId)}`;
}


function classRoom(classId) {

    return `class:${safeString(classId)}`;
}


/* ============================================================
   ONLINE COUNT
============================================================ */

function broadcastOnlineCount(roomName) {

    const room =
        io.sockets.adapter.rooms.get(roomName);

    const count =
        room ? room.size : 0;

    io.to(roomName).emit(
        "learners:online",
        {
            count
        }
    );
}


/* ============================================================
   GET LEADERBOARD
============================================================ */

async function getLeaderboard(limit = 10) {

    if (!pool) {
        return [];
    }

    try {

        const result =
            await pool.query(
                `
                SELECT
                    user_id,
                    username,
                    xp,
                    level
                FROM users
                WHERE COALESCE(is_banned, false) = false
                ORDER BY COALESCE(xp, 0) DESC
                LIMIT $1
                `,
                [limit]
            );

        return result.rows.map(
            (user, index) => ({

                rank:
                    index + 1,

                userId:
                    user.user_id,

                username:
                    user.username ||
                    "Learner",

                xp:
                    Number(user.xp || 0),

                level:
                    Number(user.level || 1)
            })
        );

    } catch (error) {

        console.error(
            "❌ Leaderboard query failed:",
            error.message
        );

        return [];
    }
}


/* ============================================================
   BROADCAST LEADERBOARD
============================================================ */

async function broadcastLeaderboard(
    roomName = null
) {

    const leaderboard =
        await getLeaderboard(10);

    const payload = {

        leaderboard,

        updatedAt:
            new Date().toISOString()
    };


    if (roomName) {

        io.to(roomName).emit(
            "leaderboard:update",
            payload
        );

    } else {

        io.emit(
            "leaderboard:update",
            payload
        );
    }
}


/* ============================================================
   SOCKET CONNECTION
============================================================ */

io.on(
    "connection",
    socket => {

        console.log(
            `🟢 Learner connected: ${socket.id}`
        );


        /* ----------------------------------------------------
           REGISTER LEARNER
        ---------------------------------------------------- */

        connectedLearners.set(
            socket.id,
            {

                socketId:
                    socket.id,

                userId:
                    socket.userId,

                authenticated:
                    socket.authenticated,

                lessonId:
                    null,

                classId:
                    null,

                userName:
                    "Learner",

                connectedAt:
                    new Date().toISOString()
            }
        );


        /* ====================================================
           LEARNER JOIN
        ==================================================== */

        socket.on(
            "learner:join",
            async data => {

                try {

                    const lessonId =
                        safeString(
                            data?.lessonId
                        );

                    const classId =
                        safeString(
                            data?.classId
                        );

                    const userName =
                        safeString(
                            data?.userName,
                            "Learner"
                        );


                    if (!lessonId) {

                        console.warn(
                            `⚠️ ${socket.id} attempted to join without lessonId`
                        );

                        return;
                    }


                    const learner =
                        connectedLearners.get(
                            socket.id
                        );


                    /* Leave previous lesson */

                    if (learner?.lessonId) {

                        socket.leave(
                            lessonRoom(
                                learner.lessonId
                            )
                        );
                    }


                    /* Join lesson */

                    socket.join(
                        lessonRoom(
                            lessonId
                        )
                    );


                    /* Join class */

                    if (classId) {

                        socket.join(
                            classRoom(
                                classId
                            )
                        );
                    }


                    /* Store learner */

                    connectedLearners.set(
                        socket.id,
                        {

                            ...(learner || {}),

                            socketId:
                                socket.id,

                            userId:
                                socket.userId,

                            authenticated:
                                socket.authenticated,

                            lessonId,

                            classId:
                                classId ||
                                null,

                            userName:
                                userName.substring(
                                    0,
                                    50
                                ),

                            connectedAt:
                                learner?.connectedAt ||
                                new Date().toISOString()
                        }
                    );


                    console.log(
                        `📚 ${userName} joined lesson ${lessonId}`
                    );


                    /* Tell learner */

                    socket.emit(
                        "learner:joined",
                        {

                            success:
                                true,

                            lessonId,

                            classId:
                                classId ||
                                null
                        }
                    );


                    /* Update lesson count */

                    broadcastOnlineCount(
                        lessonRoom(
                            lessonId
                        )
                    );


                    /* Update class count */

                    if (classId) {

                        broadcastOnlineCount(
                            classRoom(
                                classId
                            )
                        );
                    }


                    /* Send leaderboard */

                    const leaderboard =
                        await getLeaderboard(
                            10
                        );

                    socket.emit(
                        "leaderboard:update",
                        {

                            leaderboard,

                            updatedAt:
                                new Date().toISOString()
                        }
                    );

                } catch (error) {

                    console.error(
                        "❌ learner:join error:",
                        error
                    );
                }
            }
        );


        /* ====================================================
           LEARNER ACTIVITY
        ==================================================== */

        socket.on(
            "learner:activity",
            data => {

                try {

                    const learner =
                        connectedLearners.get(
                            socket.id
                        );

                    if (!learner) {
                        return;
                    }


                    const lessonId =
                        safeString(
                            data?.lessonId ||
                            learner.lessonId
                        );

                    if (!lessonId) {
                        return;
                    }


                    const activityType =
                        safeString(
                            data?.type,
                            "activity"
                        );


                    const activity = {

                        userName:
                            learner.userName ||
                            "Learner",

                        userId:
                            learner.userId ||
                            null,

                        type:
                            activityType,

                        message:
                            safeString(
                                data?.message,
                                ""
                            ).substring(
                                0,
                                200
                            ),

                        lessonId,

                        timestamp:
                            new Date().toISOString()
                    };


                    console.log(
                        `⚡ Activity: ${activity.userName} → ${activity.type}`
                    );


                    /*
                     * Broadcast to everyone else
                     * in the lesson.
                     */

                    socket
                        .to(
                            lessonRoom(
                                lessonId
                            )
                        )
                        .emit(
                            "learner:activity",
                            activity
                        );

                } catch (error) {

                    console.error(
                        "❌ learner:activity error:",
                        error
                    );
                }
            }
        );


        /* ====================================================
           QUIZ ANSWER
        ==================================================== */

        socket.on(
            "quiz:answer",
            data => {

                try {

                    const learner =
                        connectedLearners.get(
                            socket.id
                        );

                    if (!learner) {
                        return;
                    }


                    const lessonId =
                        safeString(
                            data?.lessonId ||
                            learner.lessonId
                        );

                    if (!lessonId) {
                        return;
                    }


                    const event = {

                        userName:
                            learner.userName ||
                            "Learner",

                        type:
                            "quiz_answered",

                        lessonId,

                        timestamp:
                            new Date().toISOString()
                    };


                    socket
                        .to(
                            lessonRoom(
                                lessonId
                            )
                        )
                        .emit(
                            "learner:activity",
                            event
                        );

                } catch (error) {

                    console.error(
                        "❌ quiz:answer error:",
                        error
                    );
                }
            }
        );


        /* ====================================================
           LESSON COMPLETED
        ==================================================== */

        socket.on(
            "lesson:completed",
            async data => {

                try {

                    const learner =
                        connectedLearners.get(
                            socket.id
                        );

                    if (!learner) {
                        return;
                    }


                    const lessonId =
                        safeString(
                            data?.lessonId ||
                            learner.lessonId
                        );

                    if (!lessonId) {
                        return;
                    }


                    const completion = {

                        userName:
                            learner.userName ||
                            "Learner",

                        userId:
                            learner.userId ||
                            null,

                        type:
                            "lesson_completed",

                        lessonId,

                        timestamp:
                            new Date().toISOString()
                    };


                    console.log(
                        `🎉 ${completion.userName} completed ${lessonId}`
                    );


                    /* Broadcast celebration */

                    socket
                        .to(
                            lessonRoom(
                                lessonId
                            )
                        )
                        .emit(
                            "learner:activity",
                            completion
                        );


                    /*
                     * Refresh leaderboard.
                     *
                     * XP should already have been
                     * saved through the normal API.
                     */

                    await broadcastLeaderboard(
                        lessonRoom(
                            lessonId
                        )
                    );

                } catch (error) {

                    console.error(
                        "❌ lesson:completed error:",
                        error
                    );
                }
            }
        );


        /* ====================================================
           LEADERBOARD REQUEST
        ==================================================== */

        socket.on(
            "leaderboard:request",
            async () => {

                try {

                    const leaderboard =
                        await getLeaderboard(
                            10
                        );

                    socket.emit(
                        "leaderboard:update",
                        {

                            leaderboard,

                            updatedAt:
                                new Date().toISOString()
                        }
                    );

                } catch (error) {

                    console.error(
                        "❌ leaderboard request error:",
                        error
                    );
                }
            }
        );


        /* ====================================================
           REALTIME PING
        ==================================================== */

        socket.on(
            "realtime:ping",
            () => {

                socket.emit(
                    "realtime:pong",
                    {

                        timestamp:
                            new Date().toISOString()
                    }
                );
            }
        );


        /* ====================================================
           DISCONNECT
        ==================================================== */

        socket.on(
            "disconnect",
            reason => {

                const learner =
                    connectedLearners.get(
                        socket.id
                    );


                console.log(
                    `🔴 Learner disconnected: ${socket.id} (${reason})`
                );


                const lessonId =
                    learner?.lessonId ||
                    null;

                const classId =
                    learner?.classId ||
                    null;


                connectedLearners.delete(
                    socket.id
                );


                /*
                 * Socket.IO removes the socket from rooms
                 * automatically.
                 */

                setTimeout(
                    () => {

                        if (lessonId) {

                            broadcastOnlineCount(
                                lessonRoom(
                                    lessonId
                                )
                            );
                        }


                        if (classId) {

                            broadcastOnlineCount(
                                classRoom(
                                    classId
                                )
                            );
                        }

                    },
                    0
                );
            }
        );
    }
);


/* ============================================================
   HEALTH CHECK
============================================================ */

app.get(
    "/",
    (req, res) => {

        res.json({

            success:
                true,

            service:
                "HanVerse Realtime Server",

            status:
                "online",

            socketIO:
                true,

            connectedLearners:
                connectedLearners.size,

            timestamp:
                new Date().toISOString()
        });
    }
);


app.get(
    "/health",
    async (req, res) => {

        let databaseStatus =
            "not_configured";


        if (pool) {

            try {

                await pool.query(
                    "SELECT 1"
                );

                databaseStatus =
                    "connected";

            } catch (error) {

                databaseStatus =
                    "error";
            }
        }


        res.json({

            success:
                true,

            service:
                "HanVerse Realtime",

            status:
                "online",

            database:
                databaseStatus,

            socketIO:
                true,

            connectedLearners:
                connectedLearners.size,

            timestamp:
                new Date().toISOString()
        });
    }
);


/* ============================================================
   START SERVER
============================================================ */

httpServer.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "🐼==========================================🐼"
        );

        console.log(
            "       HANVERSE REALTIME SERVER"
        );

        console.log(
            "🐼==========================================🐼"
        );

        console.log(
            `🚀 Server running on port ${PORT}`
        );

        console.log(
            "🔌 Socket.IO ready"
        );

        console.log(
            "👥 Active learner tracking ready"
        );

        console.log(
            "🏆 Leaderboard synchronization ready"
        );

        console.log(
            "⚡ Activity synchronization ready"
        );

        console.log(
            `🌐 Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`
        );

        console.log(
            `🗄️ Database: ${pool ? "configured" : "NOT CONFIGURED"}`
        );

        console.log(
            "🐼==========================================🐼"
        );

        console.log("");
    }
);


/* ============================================================
   GRACEFUL SHUTDOWN
============================================================ */

async function shutdown(signal) {

    console.log(
        `\n🛑 ${signal} received. Shutting down realtime server...`
    );


    io.close(
        () => {

            console.log(
                "🔌 Socket.IO connections closed."
            );


            httpServer.close(
                async () => {

                    console.log(
                        "🌐 HTTP server closed."
                    );


                    if (pool) {

                        try {

                            await pool.end();

                            console.log(
                                "🗄️ Database pool closed."
                            );

                        } catch (error) {

                            console.error(
                                "❌ Database shutdown error:",
                                error
                            );
                        }
                    }


                    process.exit(0);
                }
            );
        }
    );
}


process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);