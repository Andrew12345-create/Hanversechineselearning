

    /* =========================================================
       HANVERSE PLAY V2
    ========================================================= */


    const API_BASE =
        location.hostname === "localhost"
            ? "/.netlify/functions/server"
            : "/api";


    let currentUser = null;

    let lessons = [];

    let vocabulary = [];

    let quizQuestions = [];


    /* =========================================================
       GENERIC STATE
    ========================================================= */

    let flashcardIndex = 0;

    let flashcardFlipped = false;

    let quizIndex = 0;

    let quizScore = 0;


    /* =========================================================
       GAME STATE
    ========================================================= */

    const game = {

        running: false,

        paused: false,

        score: 0,

        combo: 0,

        lives: 3,

        round: 0,

        target: null,

        playerPosition: 50,

        speed: 2.4,

        spawnInterval: 1050,

        spawnTimer: null,

        animationFrame: null,

        lastTime: 0,

        objects: [],

        bestScore: 0

    };


    const $ = id =>
        document.getElementById(id);


    /* =========================================================
       API
    ========================================================= */

    async function getJSON(endpoint) {

        const response =
            await fetch(
                API_BASE + endpoint,
                {
                    credentials: "include",

                    headers: {
                        "Accept":
                            "application/json"
                    },

                    cache:
                        "no-store"
                }
            );


        const type =
            response.headers
                .get("content-type") || "";


        if (!type.includes(
            "application/json"
        )) {

            throw new Error(
                "The server returned an invalid response."
            );

        }


        const data =
            await response.json();


        if (
            !response.ok ||
            data.success === false
        ) {

            throw new Error(
                data.error ||
                data.message ||
                "Request failed."
            );

        }


        return data;

    }


    /* =========================================================
       USER
    ========================================================= */

    function getStoredUser() {

        try {

            const raw =
                localStorage.getItem(
                    "hanverse_user"
                );


            return raw
                ? JSON.parse(raw)
                : null;

        } catch {

            return null;

        }

    }


    async function loadUser() {

        const stored =
            getStoredUser();


        if (!stored) {

            return null;

        }


        const id =
            stored.user_id ||
            stored.userId ||
            stored.id;


        if (!id) {

            return stored;

        }


        try {

            const data =
                await getJSON(
                    `/user/${encodeURIComponent(id)}`
                );


            return (
                data.user ||
                stored
            );

        } catch {

            return stored;

        }

    }


    function renderUser() {

        if (!currentUser) {

            return;

        }


        const name =
            currentUser.full_name ||
            currentUser.fullName ||
            currentUser.name ||
            currentUser.username ||
            currentUser.first_name ||
            "Learner";


        $("navUserName")
            .textContent =
            name;


        if (
            currentUser.profile_picture
        ) {

            $("navAvatar").innerHTML =
                `<img
                    src="${escapeAttr(
                        currentUser.profile_picture
                    )}"
                    alt=""
                >`;

        }

    }


    /* =========================================================
       LESSON DATA
    ========================================================= */

    async function loadLessons() {

        const data =
            await getJSON(
                "/lessons"
            );


        lessons =
            Array.isArray(
                data.lessons
            )
                ? data.lessons
                : [];


        vocabulary = [];

        quizQuestions = [];


        lessons.forEach(
            lesson => {

                const words =
                    Array.isArray(
                        lesson.vocabulary
                    )
                        ? lesson.vocabulary
                        : [];


                words.forEach(
                    word => {

                        vocabulary.push({

                            ...word,

                            lessonId:
                                lesson.id,

                            lessonTitle:
                                lesson.title

                        });

                    }
                );


                const questions =
                    Array.isArray(
                        lesson.quiz
                    )
                        ? lesson.quiz
                        : [];


                questions.forEach(
                    question => {

                        quizQuestions.push({

                            ...question,

                            lessonId:
                                lesson.id,

                            lessonTitle:
                                lesson.title

                        });

                    }
                );

            }
        );


        /*
         * Some lesson data lives only in the
         * complete lesson endpoint.
         */

        if (
            vocabulary.length === 0 ||
            quizQuestions.length === 0
        ) {

            const requests =
                lessons
                    .slice(0, 20)
                    .map(
                        async lesson => {

                            try {

                                const data =
                                    await getJSON(
                                        `/lessons/${encodeURIComponent(
                                            lesson.id
                                        )}`
                                    );


                                const full =
                                    data.lesson ||
                                    data;


                                const words =
                                    Array.isArray(
                                        full.vocabulary
                                    )
                                        ? full.vocabulary
                                        : [];


                                words.forEach(
                                    word => {

                                        vocabulary.push({

                                            ...word,

                                            lessonId:
                                                lesson.id,

                                            lessonTitle:
                                                lesson.title

                                        });

                                    }
                                );


                                const questions =
                                    Array.isArray(
                                        full.quiz
                                    )
                                        ? full.quiz
                                        : [];


                                questions.forEach(
                                    question => {

                                        quizQuestions.push({

                                            ...question,

                                            lessonId:
                                                lesson.id,

                                            lessonTitle:
                                                lesson.title

                                        });

                                    }
                                );

                            } catch (error) {

                                console.warn(
                                    "Could not load lesson data:",
                                    lesson.id,
                                    error
                                );

                            }

                        }
                    );


            await Promise.all(
                requests
            );

        }


        /*
         * Remove duplicate vocabulary.
         */

        const seen =
            new Set();


        vocabulary =
            vocabulary.filter(
                word => {

                    const hanzi =
                        word.hanzi ||
                        word.chinese ||
                        word.character ||
                        word.word ||
                        "";


                    const pinyin =
                        word.pinyin ||
                        "";


                    const key =
                        `${hanzi}|${pinyin}`;


                    if (
                        !hanzi &&
                        !pinyin
                    ) {

                        return false;

                    }


                    if (
                        seen.has(key)
                    ) {

                        return false;

                    }


                    seen.add(key);

                    return true;

                }
            );

    }


    /* =========================================================
       WORKSHEETS
    ========================================================= */

    async function loadWorksheets() {

        try {

            const data =
                await getJSON(
                    "/worksheets"
                );


            const worksheets =
                Array.isArray(
                    data.worksheets
                )
                    ? data.worksheets
                    : [];


            $("worksheetLoading")
                .classList.add(
                    "hidden"
                );


            if (
                !worksheets.length
            ) {

                $("worksheetEmpty")
                    .classList.remove(
                        "hidden"
                    );

                return;

            }


            const grid =
                $("worksheetGrid");


            grid.innerHTML = "";


            worksheets.forEach(
                worksheet => {

                    const card =
                        document.createElement(
                            "article"
                        );


                    card.className =
                        "worksheet-card";


                    const level =
                        worksheet.level
                            ? `YCT ${worksheet.level}`
                            : "HanVerse";


                    const premium =
                        worksheet.premium === true;


                    card.innerHTML = `

                        <div class="worksheet-icon">
                            📄
                        </div>

                        <h3>
                            ${escapeHTML(
                                worksheet.title ||
                                "Worksheet"
                            )}
                        </h3>

                        <p>
                            ${escapeHTML(
                                worksheet.description ||
                                "Practice your Mandarin with this worksheet."
                            )}
                        </p>

                        <div class="worksheet-bottom">

                            <span class="worksheet-level">
                                ${escapeHTML(level)}
                            </span>

                            <a
                                class="worksheet-action ${
                                    premium
                                        ? "premium"
                                        : ""
                                }"
                                href="${
                                    worksheet.fileUrl ||
                                    "#"
                                }"
                                ${
                                    worksheet.fileUrl
                                        ? 'target="_blank" rel="noopener"'
                                        : ""
                                }
                            >
                                ${
                                    premium
                                        ? "✨ Premium"
                                        : "Open"
                                }
                            </a>

                        </div>

                    `;


                    grid.appendChild(
                        card
                    );

                }
            );

        } catch (error) {

            console.warn(
                "Worksheets unavailable:",
                error
            );


            $("worksheetLoading")
                .textContent =
                "Worksheets are unavailable right now.";

        }

    }


    /* =========================================================
       GAME — VOCABULARY PREPARATION
    ========================================================= */

    function getGameVocabulary() {

        const clean =
            vocabulary.filter(
                word => {

                    const hanzi =
                        word.hanzi ||
                        word.chinese ||
                        word.character ||
                        word.word ||
                        "";


                    return (
                        String(hanzi)
                            .trim()
                            .length > 0
                    );

                }
            );


        /*
         * If there is no lesson vocabulary yet,
         * don't invent learning content.
         */

        return clean;

    }


    function normalizeWord(word) {

        return {

            hanzi:
                word.hanzi ||
                word.chinese ||
                word.character ||
                word.word ||
                word.term ||
                "",

            pinyin:
                word.pinyin ||
                "",

            meaning:
                word.meaning ||
                word.english ||
                word.translation ||
                word.definition ||
                "",

            lessonTitle:
                word.lessonTitle ||
                ""

        };

    }


    /* =========================================================
       GAME — TARGET
    ========================================================= */

    function chooseTarget() {

        const words =
            getGameVocabulary();


        if (!words.length) {

            return null;

        }


        const randomIndex =
            Math.floor(
                Math.random() *
                words.length
            );


        return normalizeWord(
            words[randomIndex]
        );

    }


    function setNewTarget() {

        const target =
            chooseTarget();


        if (!target) {

            game.target =
                null;

            $("targetCharacter")
                .textContent =
                "—";


            $("targetPinyin")
                .textContent =
                "No vocabulary available";


            return false;

        }


        game.target =
            target;


        $("targetCharacter")
            .textContent =
            target.hanzi;


        $("targetPinyin")
            .textContent =
            target.pinyin ||
            target.meaning ||
            "Catch it!";


        game.round++;


        $("gameRound")
            .textContent =
            game.round;


        return true;

    }


    /* =========================================================
       GAME — FALLING CHARACTERS
    ========================================================= */

    function createFallingCharacter() {

        if (
            !game.running ||
            game.paused
        ) {

            return;

        }


        const words =
            getGameVocabulary();


        if (
            !words.length ||
            !game.target
        ) {

            return;

        }


        /*
         * Roughly 35% chance of the correct
         * answer so the game remains challenging.
         */

        let word;


        if (
            Math.random() < .35
        ) {

            word =
                game.target;

        } else {

            const candidates =
                words.filter(
                    candidate =>
                        normalizeWord(
                            candidate
                        ).hanzi !==
                        game.target.hanzi
                );


            word =
                normalizeWord(
                    candidates.length
                        ? candidates[
                            Math.floor(
                                Math.random() *
                                candidates.length
                            )
                        ]
                        : game.target
                );

        }


        const element =
            document.createElement(
                "button"
            );


        element.type =
            "button";


        element.className =
            "falling-character";


        element.textContent =
            word.hanzi;


        const stage =
            $("gameStage");


        const stageWidth =
            stage.clientWidth;


        const minX =
            12;


        const maxX =
            Math.max(
                minX,
                stageWidth - 74
            );


        const x =
            minX +
            Math.random() *
            (maxX - minX);


        element.style.left =
            `${x}px`;


        element.style.top =
            "-75px";


        stage.appendChild(
            element
        );


        const object = {

            element,

            word,

            x,

            y: -75,

            velocity:
                game.speed +
                Math.random() * .75,

            active:
                true

        };


        game.objects.push(
            object
        );


        element.addEventListener(
            "click",
            event => {

                event.preventDefault();

                catchCharacter(
                    object
                );

            }
        );

    }


    /* =========================================================
       GAME — CATCH
    ========================================================= */

    function catchCharacter(
        object
    ) {

        if (
            !game.running ||
            game.paused ||
            !object.active
        ) {

            return;

        }


        object.active =
            false;


        const isCorrect =
            object.word.hanzi ===
            game.target.hanzi;


        if (isCorrect) {

            object.element
                .classList.add(
                    "correct"
                );


            game.combo++;


            /*
             * Combo increases score.
             */

            const points =
                10 +
                Math.min(
                    game.combo * 2,
                    30
                );


            game.score +=
                points;


            showGameMessage(
                `+${points} 🎉`,
                "good"
            );


            /*
             * Every five correct catches
             * make the game faster.
             */

            if (
                game.combo > 0 &&
                game.combo % 5 === 0
            ) {

                game.speed += .35;

                showGameMessage(
                    "🔥 Faster!",
                    "good"
                );

            }


            updateGameStats();


            setNewTarget();

        } else {

            object.element
                .classList.add(
                    "wrong"
                );


            loseLife();

        }


        setTimeout(
            () => {

                removeGameObject(
                    object
                );

            },
            140
        );

    }


    /* =========================================================
       GAME — MISS
    ========================================================= */

    function handleMiss(
        object
    ) {

        if (
            !object.active
        ) {

            return;

        }


        object.active =
            false;


        /*
         * Missing a correct character costs
         * a life. Incorrect characters can
         * safely pass.
         */

        if (
            object.word.hanzi ===
            game.target.hanzi
        ) {

            loseLife();

        }


        removeGameObject(
            object
        );

    }


    /* =========================================================
       GAME — LIFE
    ========================================================= */

    function loseLife() {

        game.lives =
            Math.max(
                0,
                game.lives - 1
            );


        game.combo =
            0;


        showGameMessage(
            "❤️ Keep going!",
            "bad"
        );


        updateGameStats();


        if (
            game.lives <= 0
        ) {

            endGame();

        }

    }


    /* =========================================================
       GAME — REMOVE
    ========================================================= */

    function removeGameObject(
        object
    ) {

        const index =
            game.objects.indexOf(
                object
            );


        if (
            index !== -1
        ) {

            game.objects.splice(
                index,
                1
            );

        }


        if (
            object.element &&
            object.element.isConnected
        ) {

            object.element.remove();

        }

    }


    /* =========================================================
       GAME — LOOP
    ========================================================= */

    function gameLoop(
        timestamp
    ) {

        if (
            !game.running
        ) {

            return;

        }


        if (
            !game.lastTime
        ) {

            game.lastTime =
                timestamp;

        }


        const delta =
            Math.min(
                timestamp -
                game.lastTime,
                50
            );


        game.lastTime =
            timestamp;


        if (
            !game.paused
        ) {

            const stage =
                $("gameStage");


            const bottomLimit =
                stage.clientHeight -
                95;


            game.objects
                .slice()
                .forEach(
                    object => {

                        if (
                            !object.active
                        ) {

                            return;

                        }


                        object.y +=
                            object.velocity *
                            (delta / 16);


                        object.element.style.top =
                            `${object.y}px`;


                        /*
                         * Check whether the
                         * object has reached
                         * Panda's area.
                         */

                        if (
                            object.y >=
                            bottomLimit
                        ) {

                            const pandaCenter =
                                (
                                    game.playerPosition /
                                    100
                                ) *
                                stage.clientWidth;


                            const objectCenter =
                                object.x + 31;


                            const distance =
                                Math.abs(
                                    objectCenter -
                                    pandaCenter
                                );


                            if (
                                distance < 65
                            ) {

                                catchCharacter(
                                    object
                                );

                            } else {

                                handleMiss(
                                    object
                                );

                            }

                        }

                    }
                );

        }


        game.animationFrame =
            requestAnimationFrame(
                gameLoop
            );

    }


    /* =========================================================
       GAME — SPAWNER
    ========================================================= */

    function startSpawner() {

        stopSpawner();


        game.spawnTimer =
            setInterval(
                () => {

                    if (
                        game.running &&
                        !game.paused
                    ) {

                        createFallingCharacter();

                    }

                },
                game.spawnInterval
            );

    }


    function stopSpawner() {

        if (
            game.spawnTimer
        ) {

            clearInterval(
                game.spawnTimer
            );

            game.spawnTimer =
                null;

        }

    }


    /* =========================================================
       GAME — POSITION
    ========================================================= */

    function movePanda(
        direction
    ) {

        if (
            !game.running ||
            game.paused
        ) {

            return;

        }


        const amount =
            direction === "left"
                ? -8
                : 8;


        game.playerPosition =
            Math.max(
                8,
                Math.min(
                    92,
                    game.playerPosition +
                    amount
                )
            );


        $("pandaPlayer")
            .style.left =
            `${game.playerPosition}%`;

    }


    /* =========================================================
       GAME — START
    ========================================================= */

    function startGame() {

        const words =
            getGameVocabulary();


        if (
            words.length < 2
        ) {

            showGameDataError();

            return;

        }


        clearGameObjects();


        game.running =
            true;

        game.paused =
            false;

        game.score =
            0;

        game.combo =
            0;

        game.lives =
            3;

        game.round =
            0;

        game.playerPosition =
            50;

        game.speed =
            2.4;

        game.spawnInterval =
            1050;

        game.lastTime =
            0;


        $("pandaPlayer")
            .style.left =
            "50%";


        $("pauseGame")
            .textContent =
            "⏸ Pause";


        $("gameOverlay")
            .classList.add(
                "hidden"
            );


        $("finalScore")
            .classList.add(
                "hidden"
            );


        if (
            !setNewTarget()
        ) {

            endGame();

            return;

        }


        updateGameStats();


        startSpawner();


        game.animationFrame =
            requestAnimationFrame(
                gameLoop
            );


        /*
         * Create an immediate first
         * character so the game doesn't
         * feel empty.
         */

        setTimeout(
            () => {

                if (
                    game.running
                ) {

                    createFallingCharacter();

                }

            },
            250
        );

    }


    /* =========================================================
       GAME — PAUSE
    ========================================================= */

    function togglePause() {

        if (
            !game.running
        ) {

            return;

        }


        game.paused =
            !game.paused;


        $("pauseGame")
            .textContent =
            game.paused
                ? "▶ Resume"
                : "⏸ Pause";

    }


    /* =========================================================
       GAME — END
    ========================================================= */

    function endGame() {

        game.running =
            false;

        game.paused =
            false;


        stopSpawner();


        if (
            game.animationFrame
        ) {

            cancelAnimationFrame(
                game.animationFrame
            );

            game.animationFrame =
                null;

        }


        clearGameObjects();


        const previousBest =
            getBestScore();


        if (
            game.score >
            previousBest
        ) {

            saveBestScore(
                game.score
            );

        }


        $("finalScoreNumber")
            .textContent =
            game.score;


        $("overlayIcon")
            .textContent =
            game.score > 0
                ? "🏆"
                : "🐼";


        $("overlayTitle")
            .textContent =
            game.score > 0
                ? "Great game!"
                : "Game over";


        $("overlayDescription")
            .textContent =
            game.score > 0
                ? "Nice work! Keep playing to build your Mandarin recognition speed."
                : "Don't worry. Every round helps Panda get better!";


        $("startGame")
            .textContent =
            "↻ Play Again";


        $("finalScore")
            .classList.remove(
                "hidden"
            );


        $("gameOverlay")
            .classList.remove(
                "hidden"
            );


        $("targetCharacter")
            .textContent =
            "—";


        $("targetPinyin")
            .textContent =
            "Game finished";

    }


    /* =========================================================
       GAME — RESTART
    ========================================================= */

    function restartGame() {

        startGame();

    }


    /* =========================================================
       GAME — CLEAR
    ========================================================= */

    function clearGameObjects() {

        game.objects
            .slice()
            .forEach(
                object =>
                    removeGameObject(
                        object
                    )
            );

    }


    /* =========================================================
       GAME — DATA ERROR
    ========================================================= */

    function showGameDataError() {

        $("overlayIcon")
            .textContent =
            "📚";


        $("overlayTitle")
            .textContent =
            "Panda needs some vocabulary";


        $("overlayDescription")
            .textContent =
            "Character Catch uses vocabulary from your HanVerse lessons. Complete or load a lesson with Chinese vocabulary first.";


        $("finalScore")
            .classList.add(
                "hidden"
            );


        $("startGame")
            .textContent =
            "Go to Learn";


        $("startGame")
            .onclick =
            () => {

                window.location.href =
                    "learn.html";

            };


        $("gameOverlay")
            .classList.remove(
                "hidden"
            );

    }


    /* =========================================================
       GAME — STATS
    ========================================================= */

    function updateGameStats() {

        $("gameScore")
            .textContent =
            game.score;


        $("gameCombo")
            .textContent =
            game.combo;


        $("gameLives")
            .textContent =
            "❤️".repeat(
                game.lives
            ) +
            "🖤".repeat(
                3 -
                game.lives
            );


        $("gameRound")
            .textContent =
            game.round;


        $("bestScore")
            .textContent =
            `Best: ${getBestScore()}`;

    }


    /* =========================================================
       GAME — MESSAGE
    ========================================================= */

    function showGameMessage(
        message,
        type
    ) {

        const element =
            $("gameMessage");


        element.textContent =
            message;


        element.className =
            `game-message show ${type || ""}`;


        /*
         * Restart animation.
         */

        void element.offsetWidth;


        setTimeout(
            () => {

                element.className =
                    "game-message";

            },
            800
        );

    }


    /* =========================================================
       GAME — SCORE
    ========================================================= */

    function getBestScore() {

        try {

            const raw =
                localStorage.getItem(
                    "hanverse_character_catch_best"
                );


            const value =
                Number(raw);


            return Number.isFinite(value)
                ? Math.max(
                    0,
                    value
                )
                : 0;

        } catch {

            return 0;

        }

    }


    function saveBestScore(
        score
    ) {

        try {

            localStorage.setItem(
                "hanverse_character_catch_best",
                String(
                    Math.max(
                        0,
                        Number(score) || 0
                    )
                )
            );

        } catch {

            /*
             * Local score storage is optional.
             */

        }


        $("bestScore")
            .textContent =
            `Best: ${getBestScore()}`;

    }


    /* =========================================================
       MODAL
    ========================================================= */

    function openModal(
        title
    ) {

        $("modalTitle")
            .textContent =
            title;


        $("practiceModal")
            .classList.add(
                "open"
            );


        $("practiceModal")
            .setAttribute(
                "aria-hidden",
                "false"
            );


        document.body.classList.add(
            "game-open"
        );

    }


    function closeModal() {

        $("practiceModal")
            .classList.remove(
                "open"
            );


        $("practiceModal")
            .setAttribute(
                "aria-hidden",
                "true"
            );


        document.body.classList.remove(
            "game-open"
        );

    }


    /* =========================================================
       FLASHCARDS
    ========================================================= */

    function startFlashcards() {

        if (
            !vocabulary.length
        ) {

            openModal(
                "Flashcards"
            );


            $("modalContent")
                .innerHTML = `

                    <div class="empty">
                        There isn't any lesson vocabulary
                        available for flashcard practice yet.
                    </div>

                `;


            return;

        }


        flashcardIndex =
            0;

        flashcardFlipped =
            false;


        openModal(
            "Flashcards"
        );


        renderFlashcard();

    }


    function renderFlashcard() {

        const word =
            normalizeWord(
                vocabulary[
                    flashcardIndex %
                    vocabulary.length
                ]
            );


        $("modalContent")
            .innerHTML = `

                <div
                    class="flashcard"
                    id="flashcard"
                >

                    <div>

                        <div class="flashcard-character">
                            ${escapeHTML(
                                word.hanzi
                            )}
                        </div>

                        ${
                            flashcardFlipped
                                ? `
                                    <div class="flashcard-pinyin">
                                        ${escapeHTML(
                                            word.pinyin
                                        )}
                                    </div>

                                    <div class="flashcard-meaning">
                                        ${escapeHTML(
                                            word.meaning
                                        )}
                                    </div>
                                `
                                : `
                                    <div class="flashcard-hint">
                                        Tap the card to reveal the answer
                                    </div>
                                `
                        }

                    </div>

                </div>


                <div class="practice-controls">

                    <button
                        class="practice-button secondary"
                        id="flashPrevious"
                        type="button"
                    >
                        ← Previous
                    </button>


                    <span
                        style="
                            font-size:.7rem;
                            color:#5D7A9A;
                        "
                    >
                        ${flashcardIndex + 1}
                        /
                        ${vocabulary.length}
                    </span>


                    <button
                        class="practice-button"
                        id="flashNext"
                        type="button"
                    >
                        Next →
                    </button>

                </div>

            `;


        $("flashcard")
            .addEventListener(
                "click",
                () => {

                    flashcardFlipped =
                        !flashcardFlipped;

                    renderFlashcard();

                }
            );


        $("flashPrevious")
            .addEventListener(
                "click",
                () => {

                    flashcardIndex =
                        (
                            flashcardIndex -
                            1 +
                            vocabulary.length
                        ) %
                        vocabulary.length;


                    flashcardFlipped =
                        false;


                    renderFlashcard();

                }
            );


        $("flashNext")
            .addEventListener(
                "click",
                () => {

                    flashcardIndex =
                        (
                            flashcardIndex +
                            1
                        ) %
                        vocabulary.length;


                    flashcardFlipped =
                        false;


                    renderFlashcard();

                }
            );

    }


    /* =========================================================
       QUIZ
    ========================================================= */

    function startQuiz() {

        if (
            !quizQuestions.length
        ) {

            openModal(
                "Quick Quiz"
            );


            $("modalContent")
                .innerHTML = `

                    <div class="empty">
                        There aren't any lesson quiz questions
                        available yet.
                    </div>

                `;


            return;

        }


        quizIndex =
            0;

        quizScore =
            0;


        openModal(
            "Quick Quiz"
        );


        renderQuiz();

    }


    function renderQuiz() {

        const question =
            quizQuestions[
                quizIndex %
                quizQuestions.length
            ];


        const text =
            question.question ||
            question.prompt ||
            question.text ||
            question.question_text ||
            "Question";


        let options =
            question.options ||
            question.answers ||
            [];


        if (
            typeof options ===
            "string"
        ) {

            try {

                options =
                    JSON.parse(
                        options
                    );

            } catch {

                options = [];

            }

        }


        if (
            !Array.isArray(options) ||
            !options.length
        ) {

            options = [

                question.option_a,

                question.option_b,

                question.option_c,

                question.option_d

            ].filter(Boolean);

        }


        $("modalContent")
            .innerHTML = `

                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        margin-bottom:16px;
                        color:#5D7A9A;
                        font-size:.7rem;
                        font-weight:700;
                    "
                >

                    <span>
                        Question ${quizIndex + 1}
                    </span>

                    <span>
                        Score: ${quizScore}
                    </span>

                </div>


                <div class="quiz-question">
                    ${escapeHTML(text)}
                </div>


                <div
                    class="quiz-options"
                    id="quizOptions"
                >

                    ${options.map(
                        (
                            option,
                            index
                        ) => `

                            <button
                                class="quiz-option"
                                data-index="${index}"
                                type="button"
                            >
                                ${escapeHTML(
                                    typeof option === "object"
                                        ? (
                                            option.text ||
                                            option.answer ||
                                            option.label ||
                                            ""
                                        )
                                        : option
                                )}
                            </button>

                        `
                    ).join("")}

                </div>


                <div
                    class="quiz-result hidden"
                    id="quizResult"
                ></div>

            `;


        const correct =
            question.correct_answer ??
            question.correctAnswer ??
            question.answer ??
            question.correct_option ??
            question.correct;


        document
            .querySelectorAll(
                ".quiz-option"
            )
            .forEach(
                button => {

                    button.addEventListener(
                        "click",
                        () => {

                            const selected =
                                Number(
                                    button.dataset.index
                                );


                            const correctIndex =
                                getCorrectIndex(
                                    correct,
                                    options
                                );


                            document
                                .querySelectorAll(
                                    ".quiz-option"
                                )
                                .forEach(
                                    optionButton => {

                                        optionButton.disabled =
                                            true;

                                    }
                                );


                            if (
                                selected ===
                                correctIndex
                            ) {

                                button
                                    .classList
                                    .add(
                                        "correct"
                                    );


                                quizScore++;

                            } else {

                                button
                                    .classList
                                    .add(
                                        "wrong"
                                    );


                                const correctButton =
                                    document.querySelector(
                                        `.quiz-option[data-index="${correctIndex}"]`
                                    );


                                if (
                                    correctButton
                                ) {

                                    correctButton
                                        .classList
                                        .add(
                                            "correct"
                                        );

                                }

                            }


                            const result =
                                $("quizResult");


                            result.classList
                                .remove(
                                    "hidden"
                                );


                            result.textContent =
                                selected ===
                                correctIndex
                                    ? "🎉 Correct!"
                                    : "Keep going — you'll get it next time!";


                            setTimeout(
                                () => {

                                    quizIndex++;


                                    if (
                                        quizIndex >=
                                        Math.min(
                                            quizQuestions.length,
                                            10
                                        )
                                    ) {

                                        showQuizFinished();

                                    } else {

                                        renderQuiz();

                                    }

                                },
                                850
                            );

                        }
                    );

                }
            );

    }


    function getCorrectIndex(
        correct,
        options
    ) {

        if (
            typeof correct ===
            "number"
        ) {

            return correct;

        }


        const value =
            String(
                correct ??
                ""
            ).trim();


        if (
            /^[0-9]+$/.test(
                value
            )
        ) {

            return Number(
                value
            );

        }


        const letter =
            value.toUpperCase();


        const letters =
            [
                "A",
                "B",
                "C",
                "D"
            ];


        if (
            letters.includes(
                letter
            )
        ) {

            return letters.indexOf(
                letter
            );

        }


        const index =
            options.findIndex(
                option =>
                    String(
                        typeof option ===
                        "object"
                            ? (
                                option.text ||
                                option.answer ||
                                option.label ||
                                ""
                            )
                            : option
                    )
                        .trim()
                        .toLowerCase()
                    ===
                    value.toLowerCase()
            );


        return index >= 0
            ? index
            : 0;

    }


    function showQuizFinished() {

        const total =
            Math.min(
                quizQuestions.length,
                10
            );


        $("modalContent")
            .innerHTML = `

                <div
                    style="
                        text-align:center;
                        padding:25px 10px;
                    "
                >

                    <div
                        style="
                            font-size:3rem;
                            margin-bottom:15px;
                        "
                    >
                        🎉
                    </div>

                    <h2>
                        Quiz complete!
                    </h2>

                    <p
                        style="
                            margin-top:8px;
                            color:#5D7A9A;
                            font-size:.8rem;
                        "
                    >
                        You scored
                        ${quizScore}
                        /
                        ${total}.
                    </p>

                    <button
                        class="practice-button"
                        style="margin-top:22px;"
                        id="quizAgain"
                        type="button"
                    >
                        Try Again
                    </button>

                </div>

            `;


        $("quizAgain")
            .addEventListener(
                "click",
                startQuiz
            );

    }


    /* =========================================================
       WRITING
    ========================================================= */

    function startWriting() {

        const characters =
            vocabulary.filter(
                word =>
                    word.hanzi ||
                    word.chinese ||
                    word.character
            );


        openModal(
            "Character Practice"
        );


        if (
            !characters.length
        ) {

            $("modalContent")
                .innerHTML = `

                    <div class="empty">
                        No Chinese characters are available
                        in the current lesson vocabulary yet.
                    </div>

                `;


            return;

        }


        let index =
            0;


        function render() {

            const word =
                normalizeWord(
                    characters[
                        index %
                        characters.length
                    ]
                );


            $("modalContent")
                .innerHTML = `

                    <p
                        style="
                            text-align:center;
                            color:#5D7A9A;
                            font-size:.72rem;
                        "
                    >
                        Write this character:
                    </p>


                    <div class="writing-character">
                        ${escapeHTML(
                            word.hanzi
                        )}
                    </div>


                    <p
                        style="
                            text-align:center;
                            color:#5D7A9A;
                            font-size:.75rem;
                        "
                    >
                        ${escapeHTML(
                            word.meaning
                        )}
                    </p>


                    <input
                        class="writing-input"
                        id="writingInput"
                        placeholder="Type the character here..."
                        autocomplete="off"
                        aria-label="Type Chinese character"
                    >


                    <div class="practice-controls">

                        <button
                            class="practice-button secondary"
                            id="writingPrevious"
                            type="button"
                        >
                            ← Previous
                        </button>


                        <span
                            style="
                                color:#5D7A9A;
                                font-size:.7rem;
                            "
                        >
                            ${index + 1}
                            /
                            ${characters.length}
                        </span>


                        <button
                            class="practice-button"
                            id="writingNext"
                            type="button"
                        >
                            Next →
                        </button>

                    </div>

                `;


            $("writingInput")
                .focus();


            $("writingInput")
                .addEventListener(
                    "input",
                    event => {

                        const value =
                            event.target
                                .value
                                .trim();


                        if (
                            value ===
                            String(
                                word.hanzi
                            ).trim()
                        ) {

                            event.target.style
                                .borderColor =
                                "#16A34A";

                            event.target.style
                                .background =
                                "#DCFCE7";

                        } else {

                            event.target.style
                                .borderColor =
                                "";

                            event.target.style
                                .background =
                                "";

                        }

                    }
                );


            $("writingPrevious")
                .addEventListener(
                    "click",
                    () => {

                        index =
                            (
                                index -
                                1 +
                                characters.length
                            ) %
                            characters.length;


                        render();

                    }
                );


            $("writingNext")
                .addEventListener(
                    "click",
                    () => {

                        index =
                            (
                                index +
                                1
                            ) %
                            characters.length;


                        render();

                    }
                );

        }


        render();

    }


    /* =========================================================
       SPEAKING
    ========================================================= */

    function startSpeaking() {

        window.location.href =
            "talk.html";

    }


    /* =========================================================
       MODE EVENTS
    ========================================================= */

    document
        .querySelectorAll(
            ".mode-card"
        )
        .forEach(
            card => {

                const activate =
                    () => {

                        const mode =
                            card.dataset.mode;


                        if (
                            mode ===
                            "flashcards"
                        ) {

                            startFlashcards();

                        }


                        if (
                            mode ===
                            "quiz"
                        ) {

                            startQuiz();

                        }


                        if (
                            mode ===
                            "writing"
                        ) {

                            startWriting();

                        }


                        if (
                            mode ===
                            "speaking"
                        ) {

                            startSpeaking();

                        }


                        if (
                            mode ===
                            "tones"
                        ) {

                            startTonePairs();

                        }


                        if (
                            mode ===
                            "builder"
                        ) {

                            startBuilder();

                        }


                        if (
                            mode ===
                            "review"
                        ) {

                            startReview();

                        }

                    };


                card.addEventListener(
                    "click",
                    activate
                );


                card.addEventListener(
                    "keydown",
                    event => {

                        if (
                            event.key ===
                            "Enter" ||
                            event.key ===
                            " "
                        ) {

                            event.preventDefault();

                            activate();

                        }

                    }
                );

            }
        );


    /* =========================================================
       GAME CONTROLS
    ========================================================= */

    $("startGame")
        .addEventListener(
            "click",
            () => {

                if (
                    $("startGame")
                        .textContent
                        .includes(
                            "Go to Learn"
                        )
                ) {

                    window.location.href =
                        "learn.html";

                    return;

                }


                /*
                 * Restore the normal start
                 * handler after a data error.
                 */

                $("startGame")
                    .textContent =
                    "🎮 Start Game";


                startGame();

            }
        );


    $("pauseGame")
        .addEventListener(
            "click",
            togglePause
        );


    $("restartGame")
        .addEventListener(
            "click",
            restartGame
        );


    $("moveLeft")
        .addEventListener(
            "click",
            () =>
                movePanda("left")
        );


    $("moveRight")
        .addEventListener(
            "click",
            () =>
                movePanda("right")
        );


    /* =========================================================
       KEYBOARD
    ========================================================= */

    document.addEventListener(
        "keydown",
        event => {

            if (
                !game.running
            ) {

                return;

            }


            if (
                event.key ===
                "ArrowLeft" ||
                event.key.toLowerCase() ===
                "a"
            ) {

                event.preventDefault();

                movePanda("left");

            }


            if (
                event.key ===
                "ArrowRight" ||
                event.key.toLowerCase() ===
                "d"
            ) {

                event.preventDefault();

                movePanda("right");

            }


            if (
                event.key ===
                " " &&
                game.running
            ) {

                event.preventDefault();

                togglePause();

            }

        }
    );


    /* =========================================================
       MODAL EVENTS
    ========================================================= */

    $("closeModal")
        .addEventListener(
            "click",
            closeModal
        );


    $("practiceModal")
        .addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    $("practiceModal")
                ) {

                    closeModal();

                }

            }
        );


    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Escape"
            ) {

                if (
                    $("practiceModal")
                        .classList
                        .contains(
                            "open"
                        )
                ) {

                    closeModal();

                }

            }

        }
    );


    /* =========================================================
       FEATURE PACK GAMES — tones, builder, review, leaderboard
    ========================================================= */

    const FV = () => window.HanVerseFeatures;
    const FUID = () => (FV() ? FV().currentUserId() : null);
    const saveSession = (game, score, correct, total) => {
        const id = FUID();
        if (id && FV()) FV().games.session(id, game, score, correct, total).catch(() => {});
    };

    /* ---------- 1. TONE-PAIR LISTENING GAME ---------- */
    const TONE_WORDS = [
        { hz: "妈妈", py: "māma", en: "mother", tone: 1 },
        { hz: "骂", py: "mà", en: "scold", tone: 4 },
        { hz: "马", py: "mǎ", en: "horse", tone: 3 },
        { hz: "大", py: "dà", en: "big", tone: 4 },
        { hz: "答", py: "dá", en: "answer", tone: 2 },
        { hz: "搭", py: "dā", en: "build", tone: 1 },
        { hz: "买", py: "mǎi", en: "buy", tone: 3 },
        { hz: "卖", py: "mài", en: "sell", tone: 4 },
        { hz: "四", py: "sì", en: "four", tone: 4 },
        { hz: "十", py: "shí", en: "ten", tone: 2 },
        { hz: "是", py: "shì", en: "to be", tone: 4 },
        { hz: "他", py: "tā", en: "he", tone: 1 },
        { hz: "她", py: "tā", en: "she", tone: 1 },
        { hz: "塔", py: "tǎ", en: "tower", tone: 3 },
        { hz: "糖", py: "táng", en: "sugar", tone: 2 },
        { hz: "汤", py: "tāng", en: "soup", tone: 1 }
    ];

    let toneRounds = 0, toneCorrect = 0, toneScore = 0, tonePair = null;

    function speakHz(text, rate) {
        try {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = "zh-CN";
            u.rate = rate || 0.8;
            speechSynthesis.speak(u);
        } catch (e) { console.warn("speech unavailable"); }
    }

    function startTonePairs() {
        toneRounds = 0; toneCorrect = 0; toneScore = 0;
        openModal("Tone Pairs 🎵");
        nextToneRound();
    }

    function nextToneRound() {
        toneRounds++;
        if (toneRounds > 10) {
            saveSession("tone_pairs", toneScore, toneCorrect, 10);
            if (window.HanVerseSound) window.HanVerseSound.levelUp();
            $("modalContent").innerHTML = `
                <div class="empty">
                    <h3>Round complete! 🎵</h3>
                    <p>${toneCorrect}/10 correct — ${toneScore} points earned.</p>
                    <button class="cta" id="toneAgain">Play again</button>
                </div>`;
            $("toneAgain").onclick = () => startTonePairs();
            return;
        }

        const a = TONE_WORDS[Math.floor(Math.random() * TONE_WORDS.length)];
        let b;
        do { b = TONE_WORDS[Math.floor(Math.random() * TONE_WORDS.length)]; } while (b.hz === a.hz);
        const options = Math.random() < 0.5 ? [a, b] : [b, a];
        tonePair = a;

        $("modalContent").innerHTML = `
            <div style="text-align:center;padding:10px">
                <p style="color:var(--muted);font-size:.85rem">Listen carefully… which word did you hear?</p>
                <button class="btn-ghost" id="toneReplay" style="margin:12px auto">🔊 Hear it again</button>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
                    ${options.map((o, i) => `
                        <button class="btn-ghost tone-opt" data-i="${i}" style="min-height:110px;flex-direction:column;gap:6px">
                            <span class="cn" style="font-size:2rem;color:var(--navy)">${o.hz}</span>
                            <span style="font-size:.75rem;color:var(--muted)">${o.py}</span>
                        </button>`).join("")}
                </div>
                <p style="margin-top:14px;font-size:.78rem;color:var(--muted)">Round ${toneRounds}/10 · Score ${toneScore}</p>
            </div>`;

        const play = () => speakHz(a.hz, 0.75);
        $("toneReplay").onclick = play;
        setTimeout(play, 400);

        document.querySelectorAll(".tone-opt").forEach(btn => {
            btn.onclick = () => {
                const chosen = options[Number(btn.dataset.i)];
                const right = chosen.hz === a.hz;
                if (right) {
                    toneCorrect++; toneScore += 10;
                    if (window.HanVerseSound) window.HanVerseSound.correct();
                    btn.style.borderColor = "var(--green)"; btn.style.background = "var(--green-50)";
                } else {
                    if (window.HanVerseSound) window.HanVerseSound.wrong();
                    btn.style.borderColor = "var(--red)"; btn.style.background = "var(--red-light)";
                }
                setTimeout(nextToneRound, 700);
            };
        });
    }

    /* ---------- 2. CHARACTER BUILDER ---------- */
    const BUILDER_DATA = [
        { char: "国", parts: ["囗", "玉"], fact: "A jade (玉) inside an enclosure (囗) makes 'country'." },
        { char: "好", parts: ["女", "子"], fact: "Woman + child — the original meaning of 'good'." },
        { char: "明", parts: ["日", "月"], fact: "Sun + moon together make 'bright'." },
        { char: "休", parts: ["人", "木"], fact: "A person leaning on a tree is 'rest'." },
        { char: "你", parts: ["亻", "尔"], fact: "The person radical 亻 plus 尔 makes 'you'." },
        { char: "饿", parts: ["饣", "我"], fact: "The food radical 饣 plus 我 means 'hungry'." }
    ];

    function startBuilder() {
        const item = BUILDER_DATA[Math.floor(Math.random() * BUILDER_DATA.length)];
        const shuffled = [...item.parts].sort(() => Math.random() - 0.5);
        let built = "";

        openModal("Character Builder 🧩");
        const render = () => {
            $("modalContent").innerHTML = `
                <div style="text-align:center;padding:8px">
                    <p style="color:var(--muted);font-size:.85rem">Tap the pieces in order to build:</p>
                    <div class="cn" style="font-size:3.2rem;color:var(--blue);margin:6px 0">${item.char}</div>
                    <div style="min-height:64px;background:var(--blue-50);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;margin:12px 0" class="cn" id="builtArea">${built || "&nbsp;"}</div>
                    <div style="display:flex;gap:12px;justify-content:center">
                        ${shuffled.map(p => `<button class="btn-ghost cn builder-part" data-p="${p}" style="font-size:1.8rem;min-width:76px">${p}</button>`).join("")}
                    </div>
                    <p style="margin-top:12px;font-size:.78rem;color:var(--muted)" id="builderMsg"></p>
                </div>`;

            document.querySelectorAll(".builder-part").forEach(b => {
                b.onclick = () => {
                    built += b.dataset.p;
                    if (window.HanVerseSound) window.HanVerseSound.tap();
                    if (built === item.char) {
                        if (window.HanVerseSound) window.HanVerseSound.correct();
                        saveSession("builder", 10, 1, 1);
                        $("builtArea").textContent = built;
                        $("builderMsg").innerHTML = `✅ ${item.fact} <button class="btn-primary" id="bNext" style="min-height:38px;padding:0 16px;font-size:12px;margin-left:8px">Next →</button>`;
                        $("bNext").onclick = () => startBuilder();
                    } else if (item.char.startsWith(built)) {
                        $("builtArea").textContent = built;
                        b.disabled = true; b.style.opacity = .4;
                    } else {
                        if (window.HanVerseSound) window.HanVerseSound.wrong();
                        $("builderMsg").textContent = "Not quite — try that piece later!";
                        built = built.slice(0, -1);
                    }
                };
            });
        };
        render();
    }

    /* ---------- 3. SMART REVIEW (spaced repetition) ---------- */
    async function startReview() {
        openModal("Smart Review 🔁");
        const id = FUID();

        if (!id || !FV()) {
            $("modalContent").innerHTML = `<div class="empty">Log in to review your personal word deck.</div>`;
            return;
        }

        let cards;
        try { cards = (await FV().review.deck(id)).cards; }
        catch (e) { $("modalContent").innerHTML = `<div class="empty">${e.message}</div>`; return; }

        if (!cards.length) {
            $("modalContent").innerHTML = `
                <div class="empty">
                    <h3>Nothing due right now 🎉</h3>
                    <p>Words you meet in lessons and games land here for review at the perfect time.</p>
                </div>`;
            return;
        }
        reviewNext(id, cards, 0);
    }

    function reviewNext(id, cards, idx) {
        if (idx >= cards.length) {
            if (window.HanVerseSound) window.HanVerseSound.levelUp();
            $("modalContent").innerHTML = `<div class="empty"><h3>Deck cleared! 🔁</h3><p>See you next time — these words will come back when you're ready to forget them.</p></div>`;
            return;
        }
        const c = cards[idx];
        $("modalContent").innerHTML = `
            <div style="text-align:center;padding:8px">
                <p style="color:var(--muted);font-size:.78rem">Card ${idx + 1} of ${cards.length}</p>
                <div class="cn" style="font-size:3.4rem;color:var(--navy);margin:10px 0">${c.word}</div>
                <button class="btn-ghost" id="revSpeak" style="margin:0 auto 10px">🔊 Listen</button>
                <p style="color:var(--muted);font-size:.85rem">How well did you remember it?</p>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:8px">
                    <button class="btn-ghost" data-q="1" style="min-height:46px">😐 Forgot</button>
                    <button class="btn-ghost" data-q="4" style="min-height:46px">🙂 Okay</button>
                    <button class="btn-ghost" data-q="5" style="min-height:46px">😄 Easy</button>
                </div>
            </div>`;

        $("revSpeak").onclick = () => speakHz(c.word, 0.8);
        setTimeout(() => speakHz(c.word, 0.8), 300);
        document.querySelectorAll("[data-q]").forEach(b => {
            b.onclick = async () => {
                const q = Number(b.dataset.q);
                if (q >= 4 && window.HanVerseSound) window.HanVerseSound.correct();
                if (q < 3 && window.HanVerseSound) window.HanVerseSound.wrong();
                try { await FV().review.answer(id, c.word, q, { pinyin: c.pinyin, meaning: c.meaning }); } catch (e) {}
                reviewNext(id, cards, idx + 1);
            };
        });
    }

    /* ---------- 4. WEEKLY LEADERBOARD + WORKSHEET PRINTER ---------- */
    async function showLeaderboard() {
        const id = FUID();
        if (!id || !FV()) return;
        try {
            const data = await FV().leaderboard.weekly(id);
            if (data.optedOut) return;
            const lb = document.getElementById("leaderboardCard");
            if (!lb) return;
            lb.style.display = "";
            lb.querySelector(".lb-rows").innerHTML = data.leaders.length
                ? data.leaders.map((l, i) => `
                    <div class="lb-row${l.user_id === id ? ' me' : ''}">
                        <span class="lb-rank">${["🥇", "🥈", "🥉"][i] || `${i + 1}.`}</span>
                        <span class="lb-name">${l.full_name || l.username || "Learner"}</span>
                        <span class="lb-xp">${l.week_xp} XP</span>
                    </div>`).join("")
                : `<p style="color:var(--muted);font-size:.8rem">No XP this week yet — be the first!</p>`;
        } catch (e) { console.warn("leaderboard:", e.message); }
    }
    setTimeout(showLeaderboard, 1200);

    function printWorksheet() {
        const words = getGameVocabulary().slice(0, 12);
        if (!words.length) { alert("Learn a lesson first to generate a worksheet from its words!"); return; }
        const w = window.open("", "_blank");
        if (!w) { alert("Please allow pop-ups to print worksheets."); return; }
        w.document.write(`<!DOCTYPE html><html><head><title>HanVerse Practice Worksheet</title>
        <style>
          body{font-family:Arial,sans-serif;padding:36px;color:#0F2340}
          h1{color:#2563EB;font-size:22px} p{color:#5D7A9A;font-size:12px}
          .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:22px}
          .cell .cn{font-size:34px}.box{border:1.5px dashed #8BA8C4;height:70px;border-radius:8px;margin-top:6px}
          .py{color:#5D7A9A;font-size:12px}
          @media print{.no-print{display:none}}
        </style></head><body>
        <h1>🐼 HanVerse Writing Practice</h1>
        <p>Name: ______________________  Date: ____________</p>
        <div class="grid">${words.map(x => `<div class="cell"><div class="cn">${x.hanzi}</div><div class="py">${x.pinyin || ""} — ${x.meaning || ""}</div><div class="box"></div><div class="box"></div></div>`).join("")}</div>
        <button class="no-print" onclick="window.print()" style="margin-top:24px;padding:12px 22px;background:#2563EB;color:#fff;border:0;border-radius:12px;font-weight:700;cursor:pointer">🖨 Print</button>
        </body></html>`);
        w.document.close();
    }
    window.printWorksheet = printWorksheet;


    $("mobileToggle")
        .addEventListener(
            "click",
            () => {

                $("mobileMenu")
                    .classList
                    .toggle(
                        "open"
                    );

            }
        );


    /* =========================================================
       SECURITY
    ========================================================= */

    function escapeHTML(
        value
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );

    }


    function escapeAttr(
        value
    ) {

        return escapeHTML(
            value
        );

    }


    /* =========================================================
       INIT
    ========================================================= */

    async function init() {

        $("bestScore")
            .textContent =
            `Best: ${getBestScore()}`;


        try {

            currentUser =
                await loadUser();


            renderUser();


            await Promise.all([
                loadLessons(),
                loadWorksheets()
            ]);


            /*
             * Game is now connected to the
             * actual HanVerse lesson vocabulary.
             */

        } catch (error) {

            console.error(
                "Play V2 failed:",
                error
            );


            $("worksheetLoading")
                .textContent =
                "Some Play resources could not be loaded.";

        }

    }


    init();

