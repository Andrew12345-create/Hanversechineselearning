require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Must match scripts/generate-audio.cjs (VOICE|SPEED defaults) so paths line up
const audioPath = (text) =>
  `/assets/audio/zh/${crypto.createHash('sha1').update(`nova|0.85|${text}`).digest('hex').slice(0, 16)}.mp3`;


const LESSONS = {
  lesson_1: {
    xp: 20,
    objectives: [
      'Say 你好 (nǐ hǎo) to greet someone.',
      'Recognise and say 你 (nǐ).',
      'Recognise and say 好 (hǎo).',
      'Greet a teacher using 老师好 (lǎoshī hǎo).',
      'Say 再见 (zàijiàn) when saying goodbye.'
    ],
    content: [
      ['introduction', 'Welcome to your first Chinese lesson!', 'In this lesson, you will learn how to say hello, greet your teacher and say goodbye.'],
      ['explanation', '你好', '你好 means Hello. It is one of the most useful greetings in Mandarin.'],
      ['explanation', '老师好', '老师 means teacher. 老师好 is used to greet your teacher.'],
      ['explanation', '再见', '再见 means Goodbye. Use it when you leave someone.']
    ],
    vocabulary: [
      ['你', 'nǐ', 'you', 'pronoun', '你好！', 'Nǐ hǎo!', 'Hello!'],
      ['好', 'hǎo', 'good', 'adjective', '你好！', 'Nǐ hǎo!', 'Hello!'],
      ['你好', 'nǐ hǎo', 'hello', 'greeting', '你好！', 'Nǐ hǎo!', 'Hello!'],
      ['老师', 'lǎoshī', 'teacher', 'noun', '老师好！', 'Lǎoshī hǎo!', 'Hello, teacher!'],
      ['再见', 'zàijiàn', 'goodbye', 'greeting', '再见！', 'Zàijiàn!', 'Goodbye!']
    ],
    examples: [
      ['A', '你好！', 'Nǐ hǎo!', 'Hello!'],
      ['B', '你好！', 'Nǐ hǎo!', 'Hello!'],
      ['Student', '老师好！', 'Lǎoshī hǎo!', 'Hello, teacher!'],
      ['Teacher', '你好！', 'Nǐ hǎo!', 'Hello!'],
      ['A', '再见！', 'Zàijiàn!', 'Goodbye!'],
      ['B', '再见！', 'Zàijiàn!', 'Goodbye!']
    ],
    quiz: [
      ['What does 你好 mean?', ['Hello', 'Goodbye', 'Teacher', 'You'], 0, '你好 is a greeting meaning Hello.'],
      ['Which phrase means Goodbye?', ['你好', '再见', '老师', '你'], 1, '再见 means Goodbye.'],
      ['How do you greet your teacher?', ['你好', '再见', '老师好', '你'], 2, '老师好 means Hello, teacher.'],
      ['What does 你 mean?', ['I', 'You', 'Teacher', 'Good'], 1, '你 means you.'],
      ['What does 老师 mean?', ['Student', 'Teacher', 'Friend', 'Parent'], 1, '老师 means teacher.'],
      { type:'listening', audio:'你好', question:'Listen. Which greeting did you hear?', options:['Hello','Goodbye','Hello, teacher','You'], correct:0, explanation:'你好 (nǐ hǎo) means hello.' },
      { type:'sentence_build', question:'Tap the words in order: "Hello, teacher."', tiles:['老师','好'], explanation:'老师好 (lǎoshī hǎo) — Hello, teacher.' }
    ]
  },
  lesson_2: {
    xp: 15,
    objectives: [
      'Count from 1 to 10 in Mandarin Chinese.',
      'Recognise the Chinese characters for numbers 1\u201310.',
      'Pronounce the numbers with the correct Mandarin tones.',
      "Answer \u201cHow old are you?\u201d using \u6211...\u5c81\u4e86 (w\u01d2 ... su\u00ec le).",
      'Use numbers in simple Mandarin sentences, like \u6211\u6709\u4e09\u4e2a\u82f9\u679c.'
    ],
    content: [
      ['introduction', 'Welcome to Numbers 1\u201310', 'Numbers are essential in any language. In this lesson, you will learn how to count from 1 to 10 in Mandarin Chinese. Practice the tones carefully!'],
      ['explanation', '\u4e00\u5230\u4e94 (One to Five)', '\u4e00 (y\u012b), \u4e8c (\u00e8r), \u4e09 (s\u0101n), \u56db (s\u00ec), \u4e94 (w\u01d4) are the numbers one through five. Say them slowly, then try saying them in order.'],
      ['explanation', '\u516d\u5230\u5341 (Six to Ten)', '\u516d (li\u00f9), \u4e03 (q\u012b), \u516b (b\u0101), \u4e5d (ji\u01d4), \u5341 (sh\u00ed) are the numbers six through ten. Keep practicing until you can count 1\u201310 without stopping.'],
      ['explanation', '\u4f60\u51e0\u5c81\u4e86\uff1f (How old are you?)', '\u51e0 means \u201chow many\u201d and \u5c81 means \u201cyears old\u201d. To say your age, use the pattern \u6211 + number + \u5c81\u4e86, for example \u6211\u4e03\u5c81\u4e86 (I am seven years old).']
    ],
    vocabulary: [
      ['\u4e00', 'y\u012b', 'One', 'number', '\u4e00\u4e2a\u82f9\u679c', 'y\u012b g\u00e8 p\u00ednggu\u01d2', 'one apple'],
      ['\u4e8c', '\u00e8r', 'Two', 'number', '\u4e24\u4e2a\u82f9\u679c', 'li\u01ceng g\u00e8 p\u00ednggu\u01d2', 'two apples'],
      ['\u4e09', 's\u0101n', 'Three', 'number', '\u4e09\u4e2a\u82f9\u679c', 's\u0101n g\u00e8 p\u00ednggu\u01d2', 'three apples'],
      ['\u56db', 's\u00ec', 'Four', 'number', '\u56db\u4e2a\u82f9\u679c', 's\u00ec g\u00e8 p\u00ednggu\u01d2', 'four apples'],
      ['\u4e94', 'w\u01d4', 'Five', 'number', '\u4e94\u4e2a\u82f9\u679c', 'w\u01d4 g\u00e8 p\u00ednggu\u01d2', 'five apples'],
      ['\u516d', 'li\u00f9', 'Six', 'number', '\u516d\u4e2a\u82f9\u679c', 'li\u00f9 g\u00e8 p\u00ednggu\u01d2', 'six apples'],
      ['\u4e03', 'q\u012b', 'Seven', 'number', '\u6211\u4e03\u5c81\u4e86\u3002', 'W\u01d2 q\u012b su\u00ec le.', 'I am seven years old.'],
      ['\u516b', 'b\u0101', 'Eight', 'number', '\u516b\u4e2a\u82f9\u679c', 'b\u0101 g\u00e8 p\u00ednggu\u01d2', 'eight apples'],
      ['\u4e5d', 'ji\u01d4', 'Nine', 'number', '\u4e5d\u4e2a\u82f9\u679c', 'ji\u01d4 g\u00e8 p\u00ednggu\u01d2', 'nine apples'],
      ['\u5341', 'sh\u00ed', 'Ten', 'number', '\u5341\u4e2a\u82f9\u679c', 'sh\u00ed g\u00e8 p\u00ednggu\u01d2', 'ten apples']
    ],
    examples: [
      ['A', '\u4f60\u51e0\u5c81\u4e86\uff1f', 'N\u01d0 j\u01d0 su\u00ec le?', 'How old are you?'],
      ['B', '\u6211\u4e03\u5c81\u4e86\u3002', 'W\u01d2 q\u012b su\u00ec le.', "I'm seven years old."],
      ['A', '\u4f60\u6709\u51e0\u4e2a\u82f9\u679c\uff1f', 'N\u01d0 y\u01d2u j\u01d0 g\u00e8 p\u00ednggu\u01d2?', 'How many apples do you have?'],
      ['B', '\u6211\u6709\u4e09\u4e2a\u82f9\u679c\u3002', 'W\u01d2 y\u01d2u s\u0101n g\u00e8 p\u00ednggu\u01d2.', 'I have three apples.'],
      ['Teacher', '\u6211\u4eec\u4e00\u8d77\u6570\u4e00\u6570\uff01\u4e00\u3001\u4e8c\u3001\u4e09\u3001\u56db\u3001\u4e94\uff01', 'W\u01d2men y\u00ecq\u01d0 sh\u01d4 yi sh\u01d4! Y\u012b, \u00e8r, s\u0101n, s\u00ec, w\u01d4!', "Let's count together! One, two, three, four, five!"],
      ['Students', '\u516d\u3001\u4e03\u3001\u516b\u3001\u4e5d\u3001\u5341\uff01', 'Li\u00f9, q\u012b, b\u0101, ji\u01d4, sh\u00ed!', 'Six, seven, eight, nine, ten!']
    ],
    quiz: [
      ['What is the Mandarin word for Three?', ['\u4e00', '\u4e8c', '\u4e09', '\u56db'], 2, '\u4e09 (s\u0101n) means three.'],
      ['What number is \u4e94?', ['Three', 'Four', 'Five', 'Six'], 2, '\u4e94 (w\u01d4) means five.'],
      ['How do you say Ten in Mandarin?', ['\u4e5d', '\u5341', '\u516b', '\u4e03'], 1, '\u5341 (sh\u00ed) means ten.'],
      ['What is the pinyin for \u516b?', ['q\u012b', 'b\u0101', 'ji\u01d4', 'li\u00f9'], 1, '\u516b is pronounced b\u0101.'],
      ['How do you ask "How old are you?" in Mandarin?', ['\u4f60\u51e0\u5c81\u4e86\uff1f', '\u4f60\u597d\u5417\uff1f', '\u4f60\u53eb\u4ec0\u4e48\u540d\u5b57\uff1f', '\u518d\u89c1'], 0, '\u4f60\u51e0\u5c81\u4e86\uff1f (N\u01d0 j\u01d0 su\u00ec le?) means "How old are you?"'],
      { type:'listening', audio:'一', question:'Listen. Which number did you hear?', options:['One','Two','Six','Ten'], correct:0, explanation:'一 (yī) means one.' },
      { type:'sentence_build', question:'Tap the words in order: “I have three apples.”', tiles:['我','有','三','个','苹果'], explanation:'我有三个苹果 (Wǒ yǒu sān gè píngguǒ) — I have three apples.' }
    ]
  },
  lesson_3: {
    xp: 10,
    objectives: [
      'Name basic colours in Mandarin: red, blue, yellow and green.',
      'Recognise \u9ed1\u8272 (black) and \u767d\u8272 (white).',
      'Ask "What colour is it?" using \u8fd9\u662f\u4ec0\u4e48\u989c\u8272\uff1f',
      "Describe an object's colour, e.g. \u8fd9\u662f\u7ea2\u8272\u7684\u4e66\u3002",
      'Recognise classroom objects: \u4e66 (book) and \u684c\u5b50 (table).'
    ],
    content: [
      ['introduction', 'Welcome to Colours & Objects', "In this lesson, you'll learn how to describe colours and name common classroom objects in Mandarin."],
      ['explanation', '\u57fa\u672c\u989c\u8272 (Basic colours)', '\u7ea2\u8272 (h\u00f3ngs\u00e8) red, \u84dd\u8272 (l\u00e1ns\u00e8) blue, \u9ec4\u8272 (hu\u00e1ngs\u00e8) yellow and \u7eff\u8272 (l\u01dcs\u00e8) green are the four basic colours to start with.'],
      ['explanation', '\u9ed1\u8272\u548c\u767d\u8272 (Black and white)', '\u9ed1\u8272 (h\u0113is\u00e8) means black and \u767d\u8272 (b\u00e1is\u00e8) means white. These two colours are opposites, just like in English.'],
      ['explanation', '\u8fd9\u662f\u4ec0\u4e48\u989c\u8272\uff1f (What colour is this?)', 'Use the pattern \u8fd9\u662f + colour + \u7684 + object to describe things, for example \u8fd9\u662f\u7ea2\u8272\u7684\u4e66 (This is a red book).']
    ],
    vocabulary: [
      ['\u7ea2\u8272', 'h\u00f3ngs\u00e8', 'Red', 'adjective', '\u8fd9\u662f\u7ea2\u8272\u7684\u4e66\u3002', 'Zh\u00e8 sh\u00ec h\u00f3ngs\u00e8 de sh\u016b.', 'This is a red book.'],
      ['\u84dd\u8272', 'l\u00e1ns\u00e8', 'Blue', 'adjective', '\u6211\u7684\u7b14\u662f\u84dd\u8272\u7684\u3002', 'W\u01d2 de b\u01d0 sh\u00ec l\u00e1ns\u00e8 de.', 'My pen is blue.'],
      ['\u9ec4\u8272', 'hu\u00e1ngs\u00e8', 'Yellow', 'adjective', '\u9ec4\u8272\u7684\u684c\u5b50', 'hu\u00e1ngs\u00e8 de zhu\u014dzi', 'a yellow table'],
      ['\u7eff\u8272', 'l\u01dcs\u00e8', 'Green', 'adjective', '\u7eff\u8272\u7684\u7b14', 'l\u01dcs\u00e8 de b\u01d0', 'a green pen'],
      ['\u9ed1\u8272', 'h\u0113is\u00e8', 'Black', 'adjective', '\u9ed1\u8272\u7684\u4e66', 'h\u0113is\u00e8 de sh\u016b', 'a black book'],
      ['\u767d\u8272', 'b\u00e1is\u00e8', 'White', 'adjective', '\u767d\u8272\u7684\u684c\u5b50', 'b\u00e1is\u00e8 de zhu\u014dzi', 'a white table'],
      ['\u4e66', 'sh\u016b', 'Book', 'noun', '\u8fd9\u662f\u6211\u7684\u4e66\u3002', 'Zh\u00e8 sh\u00ec w\u01d2 de sh\u016b.', 'This is my book.'],
      ['\u684c\u5b50', 'zhu\u014dzi', 'Table', 'noun', '\u684c\u5b50\u662f\u9ed1\u8272\u7684\u3002', 'Zhu\u014dzi sh\u00ec h\u0113is\u00e8 de.', 'The table is black.']
    ],
    examples: [
      ['A', '\u8fd9\u662f\u4ec0\u4e48\u989c\u8272\uff1f', 'Zh\u00e8 sh\u00ec sh\u00e9nme y\u00e1ns\u00e8?', 'What colour is this?'],
      ['B', '\u8fd9\u662f\u7ea2\u8272\u3002', 'Zh\u00e8 sh\u00ec h\u00f3ngs\u00e8.', 'This is red.'],
      ['A', '\u4f60\u7684\u4e66\u662f\u4ec0\u4e48\u989c\u8272\uff1f', 'N\u01d0 de sh\u016b sh\u00ec sh\u00e9nme y\u00e1ns\u00e8?', 'What colour is your book?'],
      ['B', '\u6211\u7684\u4e66\u662f\u84dd\u8272\u7684\u3002', 'W\u01d2 de sh\u016b sh\u00ec l\u00e1ns\u00e8 de.', 'My book is blue.'],
      ['A', '\u684c\u5b50\u662f\u9ed1\u8272\u7684\u5417\uff1f', 'Zhu\u014dzi sh\u00ec h\u0113is\u00e8 de ma?', 'Is the table black?'],
      ['B', '\u4e0d\u662f\uff0c\u684c\u5b50\u662f\u767d\u8272\u7684\u3002', 'B\u00fa sh\u00ec, zhu\u014dzi sh\u00ec b\u00e1is\u00e8 de.', 'No, the table is white.']
    ],
    quiz: [
      ['What is the Mandarin word for "Red"?', ['\u7ea2\u8272', '\u84dd\u8272', '\u9ec4\u8272', '\u7eff\u8272'], 0, '\u7ea2\u8272 (h\u00f3ngs\u00e8) means red.'],
      ['What is the Mandarin word for "Book"?', ['\u4e66', '\u684c\u5b50', '\u6905\u5b50', '\u95e8'], 0, '\u4e66 (sh\u016b) means book.'],
      ['What colour is \u9ed1\u8272?', ['White', 'Black', 'Green', 'Yellow'], 1, '\u9ed1\u8272 (h\u0113is\u00e8) means black.'],
      ['How do you ask "What colour is this?" in Mandarin?', ['\u8fd9\u662f\u4ec0\u4e48\u989c\u8272\uff1f', '\u4f60\u597d\u5417\uff1f', '\u8fd9\u662f\u4ec0\u4e48\uff1f', '\u518d\u89c1'], 0, '\u8fd9\u662f\u4ec0\u4e48\u989c\u8272\uff1f (Zh\u00e8 sh\u00ec sh\u00e9nme y\u00e1ns\u00e8?) means "What colour is this?"'],
      ['What is the pinyin for \u7eff\u8272?', ['l\u01dcs\u00e8', 'l\u00e1ns\u00e8', 'b\u00e1is\u00e8', 'h\u0113is\u00e8'], 0, '\u7eff\u8272 is pronounced l\u01dcs\u00e8.'],
      { type:'listening', audio:'红色', question:'Listen. Which colour did you hear?', options:['Red','Blue','Green','Black'], correct:0, explanation:'红色 (hóngsè) means red.' },
      { type:'sentence_build', question:'Tap the words in order: “My book is blue.”', tiles:['我','的','书','是','蓝色','的'], explanation:'我的书是蓝色的 (Wǒ de shū shì lánsè de) — My book is blue.' }
    ]
  },
  lesson_4: {
    xp: 15,
    objectives: [
      'Name family members: 爸爸, 妈妈, 哥哥, 姐姐, 弟弟, 妹妹.',
      'Tell the difference between older and younger siblings.',
      'Say how many people are in your family using 我家有...口人.',
      'Ask "Who is this?" with 这是谁？ and introduce a family member.',
      'Say you have a sibling with 我有一个哥哥.'
    ],
    content: [
      ['introduction', 'Welcome to Family Members', 'In this lesson you will learn how to talk about your family in Mandarin: who is in it, which siblings you have, and how to introduce them.'],
      ['explanation', '家人 (Family members)', '爸爸 (bàba) is Dad and 妈妈 (māma) is Mom. Together they are your parents. Other family members are 哥哥, 姐姐, 弟弟 and 妹妹.'],
      ['explanation', '哥哥/姐姐 vs 弟弟/妹妹', 'In Chinese, the word you use depends on whether the sibling is older or younger than you. 哥哥 (gēge) and 姐姐 (jiějie) are older. 弟弟 (dìdi) and 妹妹 (mèimei) are younger.'],
      ['explanation', '我家有...口人 (How many people are in your family?)', '家 (jiā) means family or home. 口 (kǒu) is the measure word for people in a family. Pattern: 我家有 + number + 口人. Example: 我家有四口人 (Our family has four people).']
    ],
    vocabulary: [
      ['爸爸', 'bàba', 'Dad', 'noun', '我爸爸是老师。', 'Wǒ bàba shì lǎoshī.', 'My dad is a teacher.'],
      ['妈妈', 'māma', 'Mom', 'noun', '妈妈很好。', 'Māma hěn hǎo.', 'Mom is very nice.'],
      ['哥哥', 'gēge', 'Older brother', 'noun', '我有一个哥哥。', 'Wǒ yǒu yí gè gēge.', 'I have one older brother.'],
      ['姐姐', 'jiějie', 'Older sister', 'noun', '我的姐姐很高。', 'Wǒ de jiějie hěn gāo.', 'My older sister is very tall.'],
      ['弟弟', 'dìdi', 'Younger brother', 'noun', '我有一个弟弟。', 'Wǒ yǒu yí gè dìdi.', 'I have a younger brother.'],
      ['妹妹', 'mèimei', 'Younger sister', 'noun', '妹妹很可爱。', 'Mèimei hěn kě\'ài.', 'My younger sister is very cute.'],
      ['家', 'jiā', 'Family / home', 'noun', '我家有四口人。', 'Wǒ jiā yǒu sì kǒu rén.', 'Our family has four people.']
    ],
    examples: [
      ['A', '你家有几口人？', 'Nǐ jiā yǒu jǐ kǒu rén?', 'How many people are in your family?'],
      ['B', '我家有四口人。', 'Wǒ jiā yǒu sì kǒu rén.', 'Our family has four people.'],
      ['A', '这是谁？', 'Zhè shì shéi?', 'Who is this?'],
      ['B', '这是我妈妈。', 'Zhè shì wǒ māma.', 'This is my mom.'],
      ['A', '你有哥哥吗？', 'Nǐ yǒu gēge ma?', 'Do you have an older brother?'],
      ['B', '有，我有一个哥哥。', 'Yǒu, wǒ yǒu yí gè gēge.', 'Yes, I have one older brother.']
    ],
    quiz: [
      ['How do you say "Mom" in Mandarin?', ['爸爸', '妈妈', '哥哥', '姐姐'], 1, '妈妈 (māma) means mom.'],
      ['What does 哥哥 mean?', ['Younger brother', 'Older brother', 'Older sister', 'Dad'], 1, '哥哥 (gēge) means older brother.'],
      ['Which word means "younger sister"?', ['姐姐', '妹妹', '弟弟', '哥哥'], 1, '妹妹 (mèimei) means younger sister.'],
      ['How do you ask "Who is this?" in Mandarin?', ['这是谁？', '你好吗？', '你几岁了？', '再见'], 0, '这是谁？ (Zhè shì shéi?) means "Who is this?"'],
      ['What is the pinyin for 弟弟?', ['jiějie', 'dìdi', 'mèimei', 'gēge'], 1, '弟弟 is pronounced dìdi.'],
      { type:'listening', audio:'妈妈', question:'Listen. Which family member did you hear?', options:['Mom','Dad','Older sister','Younger brother'], correct:0, explanation:'妈妈 (māma) means mom.' },
      { type:'sentence_build', question:'Tap the words in order: “I have one older brother.”', tiles:['我','有','一','个','哥哥'], explanation:'我有一个哥哥 (Wǒ yǒu yí gè gēge) — I have one older brother.' }
    ]
  },
  lesson_5: {
    xp: 15,
    objectives: [
      'Name five daily activities: 起床, 吃饭, 上学, 写作业, 睡觉.',
      'Say when you do something using time words like 早上 and 晚上.',
      'Put time words before the verb: 我早上七点起床.',
      'Ask "What do you do every day?" with 你每天做什么？'
    ],
    content: [
      ['introduction', 'Welcome to Daily Activities', 'In this lesson you will learn how to describe your daily routine: when you wake up, eat, go to school, do homework and go to sleep.'],
      ['explanation', 'Daily activity words', '起床 (qǐchuáng) wake up, 吃饭 (chīfàn) eat a meal, 上学 (shàngxué) go to school, 写作业 (xiě zuòyè) do homework, 睡觉 (shuìjiào) sleep. Many of these are two-part phrases, and they are used as one verb.'],
      ['explanation', 'Time words come before the verb', 'Put the time word after the subject and before the verb. Pattern: 我 + time + verb. Example: 我早上起床 (I wake up in the morning). 早上 (zǎoshang) means morning and 晚上 (wǎnshang) means evening.'],
      ['explanation', '你每天做什么？ (What do you do every day?)', '每天 (měitiān) means every day and 做 (zuò) means do. Ask 你每天做什么？ and answer with 我每天... (I ... every day).']
    ],
    vocabulary: [
      ['起床', 'qǐchuáng', 'Wake up', 'verb', '我早上七点起床。', 'Wǒ zǎoshang qī diǎn qǐchuáng.', 'I wake up at seven in the morning.'],
      ['吃饭', 'chīfàn', 'Eat (a meal)', 'verb', '我们一起吃饭。', 'Wǒmen yìqǐ chīfàn.', "Let's eat together."],
      ['上学', 'shàngxué', 'Go to school', 'verb', '我每天上学。', 'Wǒ měitiān shàngxué.', 'I go to school every day.'],
      ['写作业', 'xiě zuòyè', 'Do homework', 'verb', '我晚上写作业。', 'Wǒ wǎnshang xiě zuòyè.', 'I do homework in the evening.'],
      ['睡觉', 'shuìjiào', 'Sleep', 'verb', '我晚上十点睡觉。', 'Wǒ wǎnshang shí diǎn shuìjiào.', 'I go to sleep at ten at night.'],
      ['早上', 'zǎoshang', 'Morning', 'time', '早上好！', 'Zǎoshang hǎo!', 'Good morning!'],
      ['晚上', 'wǎnshang', 'Evening / night', 'time', '晚上好！', 'Wǎnshang hǎo!', 'Good evening!']
    ],
    examples: [
      ['A', '你每天做什么？', 'Nǐ měitiān zuò shénme?', 'What do you do every day?'],
      ['B', '我早上起床，然后上学。', 'Wǒ zǎoshang qǐchuáng, ránhòu shàngxué.', 'I wake up in the morning, then go to school.'],
      ['A', '你晚上做什么？', 'Nǐ wǎnshang zuò shénme?', 'What do you do in the evening?'],
      ['B', '我晚上写作业，然后睡觉。', 'Wǒ wǎnshang xiě zuòyè, ránhòu shuìjiào.', 'In the evening I do homework, then sleep.'],
      ['Teacher', '同学们，我们一起说：起床、吃饭、上学！', 'Tóngxuémen, wǒmen yìqǐ shuō: qǐchuáng, chīfàn, shàngxué!', "Students, let's say together: wake up, eat, go to school!"],
      ['Students', '好！', 'Hǎo!', 'Okay!']
    ],
    quiz: [
      ['How do you say "Eat" in Mandarin?', ['吃饭', '睡觉', '上学', '起床'], 0, '吃饭 (chīfàn) means to eat a meal.'],
      ['What does 上学 mean?', ['Go to school', 'Wake up', 'Sleep', 'Eat'], 0, '上学 (shàngxué) means to go to school.'],
      ['How do you say "Do homework"?', ['写作业', '上学', '睡觉', '吃饭'], 0, '写作业 (xiě zuòyè) means to do homework.'],
      ['What does 早上 mean?', ['Evening', 'Morning', 'Night', 'Noon'], 1, '早上 (zǎoshang) means morning.'],
      ['How do you ask "What do you do every day?"', ['你每天做什么？', '你好吗？', '你几岁了？', '再见'], 0, '你每天做什么？ (Nǐ měitiān zuò shénme?) means "What do you do every day?"'],
      { type:'listening', audio:'起床', question:'Listen. Which activity did you hear?', options:['Wake up','Sleep','Eat','Go to school'], correct:0, explanation:'起床 (qǐchuáng) means to wake up.' },
      { type:'sentence_build', question:'Tap the words in order: “I wake up at seven in the morning.”', tiles:['我','早上','七点','起床'], explanation:'我早上七点起床 (Wǒ zǎoshang qī diǎn qǐchuáng) — I wake up at seven in the morning.' }
    ]
  },
  lesson_6: {
    xp: 20,
    objectives: [
      'Name common foods and drinks: 米饭, 面条, 饺子, 水, 茶, 咖啡.',
      'Order politely with 我要 + item.',
      'Use 喝 for drinks and 吃 for food.',
      'Ask "Do you drink tea?" with 你喝茶吗？ and describe food with 好吃.'
    ],
    content: [
      ['introduction', 'Welcome to Food & Drinks', 'In this lesson you will learn the names of common foods and drinks, how to order politely, and how to say what you like to eat and drink.'],
      ['explanation', '吃 vs 喝 (eat vs drink)', 'Use 吃 (chī) for food, such as 吃米饭 (eat rice). Use 喝 (hē) for drinks, such as 喝水 (drink water).'],
      ['explanation', '我要... (I would like...)', '我要 (wǒ yào) is a polite way to order. A measure word goes between the number and the item: 一杯水 (a glass of water), 一碗面条 (a bowl of noodles). 杯 (bēi) is for cups and 碗 (wǎn) is for bowls.'],
      ['explanation', '好吃 (delicious)', '好吃 (hǎochī) means delicious. Add 很 to make it a sentence: 饺子很好吃 (The dumplings are delicious).']
    ],
    vocabulary: [
      ['米饭', 'mǐfàn', 'Rice', 'noun', '我想吃米饭。', 'Wǒ xiǎng chī mǐfàn.', 'I want to eat rice.'],
      ['面条', 'miàntiáo', 'Noodles', 'noun', '我喜欢面条。', 'Wǒ xǐhuan miàntiáo.', 'I like noodles.'],
      ['饺子', 'jiǎozi', 'Dumplings', 'noun', '饺子很好吃。', 'Jiǎozi hěn hǎochī.', 'The dumplings are delicious.'],
      ['水', 'shuǐ', 'Water', 'noun', '我要一杯水。', 'Wǒ yào yì bēi shuǐ.', "I'd like a glass of water."],
      ['茶', 'chá', 'Tea', 'noun', '你喝茶吗？', 'Nǐ hē chá ma?', 'Do you drink tea?'],
      ['咖啡', 'kāfēi', 'Coffee', 'noun', '我爸爸喝咖啡。', 'Wǒ bàba hē kāfēi.', 'My dad drinks coffee.'],
      ['好吃', 'hǎochī', 'Delicious', 'adjective', '这个面条很好吃。', 'Zhège miàntiáo hěn hǎochī.', 'These noodles are delicious.'],
      ['我要', 'wǒ yào', 'I want / I would like', 'phrase', '我要米饭。', 'Wǒ yào mǐfàn.', "I'd like rice."]
    ],
    examples: [
      ['A', '你要什么？', 'Nǐ yào shénme?', 'What would you like?'],
      ['B', '我要一碗面条。', 'Wǒ yào yì wǎn miàntiáo.', "I'd like a bowl of noodles."],
      ['A', '你喝水吗？', 'Nǐ hē shuǐ ma?', 'Do you drink water?'],
      ['B', '我喝水。', 'Wǒ hē shuǐ.', 'I drink water.'],
      ['A', '饺子好吃吗？', 'Jiǎozi hǎochī ma?', 'Are the dumplings delicious?'],
      ['B', '很好吃！', 'Hěn hǎochī!', 'Very delicious!'],
      ['Teacher', '请喝茶！', 'Qǐng hē chá!', 'Please have some tea!']
    ],
    quiz: [
      ['How do you say "Rice" in Mandarin?', ['米饭', '面条', '水', '茶'], 0, '米饭 (mǐfàn) means rice.'],
      ['What does 茶 mean?', ['Water', 'Tea', 'Coffee', 'Rice'], 1, '茶 (chá) means tea.'],
      ['Which word means "delicious"?', ['好吃', '好看', '好的', '再见'], 0, '好吃 (hǎochī) means delicious.'],
      ['Which sentence means "I\'d like a glass of water"?', ['我要一杯水。', '我爸爸是老师。', '你喝茶吗？', '再见。'], 0, '我要一杯水 (Wǒ yào yì bēi shuǐ) means "I\'d like a glass of water."'],
      ['What is the pinyin for 咖啡?', ['kāfēi', 'chá', 'shuǐ', 'miàntiáo'], 0, '咖啡 is pronounced kāfēi.'],
      { type:'listening', audio:'茶', question:'Listen. Which drink did you hear?', options:['Tea','Water','Coffee','Milk'], correct:0, explanation:'茶 (chá) means tea.' },
      { type:'sentence_build', question:'Tap the words in order: “I would like a bowl of noodles.”', tiles:['我','要','一','碗','面条'], explanation:'我要一碗面条 (Wǒ yào yì wǎn miàntiáo) — I would like a bowl of noodles.' }
    ]
  },
  lesson_7: {
    xp: 25,
    objectives: [
      'Use exam vocabulary: 考试, 问题, 答案, 复习.',
      'Understand key exam instructions: 听, 认真.',
      'Encourage yourself and others with 加油.',
      'Review vocabulary from Levels 1–3 before the exam.'
    ],
    content: [
      ['introduction', 'Welcome to Exam Practice', 'This lesson helps you prepare for your YCT exam. You will review useful exam words, learn how to read instructions, and practise with questions similar to the ones in the test.'],
      ['explanation', 'Exam vocabulary', '考试 (kǎoshì) is an exam, 问题 (wèntí) is a question, 答案 (dá\'àn) is an answer and 复习 (fùxí) means to review. Knowing these words helps you understand the instructions.'],
      ['explanation', 'Listen and read carefully', '听 (tīng) means listen. 认真 (rènzhēn) means careful or serious. Before every answer, listen to the whole question or read the whole sentence, then choose.'],
      ['explanation', '加油！ (Come on! You can do it!)', '加油 (jiāyóu) is used to encourage someone before a test or game. Say it to yourself and to your friends before the exam.']
    ],
    vocabulary: [
      ['考试', 'kǎoshì', 'Exam / test', 'noun', '明天有考试。', 'Míngtiān yǒu kǎoshì.', 'There is an exam tomorrow.'],
      ['问题', 'wèntí', 'Question / problem', 'noun', '这个问题很简单。', 'Zhège wèntí hěn jiǎndān.', 'This question is very simple.'],
      ['答案', 'dá\'àn', 'Answer', 'noun', '我知道答案。', 'Wǒ zhīdào dá\'àn.', 'I know the answer.'],
      ['复习', 'fùxí', 'To review', 'verb', '我每天复习。', 'Wǒ měitiān fùxí.', 'I review every day.'],
      ['听', 'tīng', 'To listen', 'verb', '请认真听。', 'Qǐng rènzhēn tīng.', 'Please listen carefully.'],
      ['认真', 'rènzhēn', 'Careful / serious', 'adjective', '他很认真。', 'Tā hěn rènzhēn.', 'He is very careful.'],
      ['加油', 'jiāyóu', 'Come on! / Good luck!', 'phrase', '加油！', 'Jiāyóu!', 'Come on! You can do it!']
    ],
    examples: [
      ['A', '明天有考试吗？', 'Míngtiān yǒu kǎoshì ma?', 'Is there an exam tomorrow?'],
      ['B', '有。我要复习。', 'Yǒu. Wǒ yào fùxí.', 'Yes. I need to review.'],
      ['A', '这个问题的答案是什么？', 'Zhège wèntí de dá\'àn shì shénme?', 'What is the answer to this question?'],
      ['B', '答案是三。', 'Dá\'àn shì sān.', 'The answer is three.'],
      ['A', '请认真听。', 'Qǐng rènzhēn tīng.', 'Please listen carefully.'],
      ['B', '好，加油！', 'Hǎo, jiāyóu!', 'OK, you can do it!']
    ],
    quiz: [
      ['How do you say "Exam" in Mandarin?', ['考试', '问题', '答案', '复习'], 0, '考试 (kǎoshì) means exam.'],
      ['What does 答案 mean?', ['Question', 'Answer', 'Review', 'Exam'], 1, '答案 (dá\'àn) means answer.'],
      ['What does 加油 mean?', ['Come on / You can do it', 'Goodbye', 'Sorry', 'Thank you'], 0, '加油 (jiāyóu) is used to encourage someone.'],
      ['Which word means "to review"?', ['复习', '考试', '听', '认真'], 0, '复习 (fùxí) means to review.'],
      ['What is the pinyin for 问题?', ['wèntí', 'dá\'àn', 'kǎoshì', 'fùxí'], 0, '问题 is pronounced wèntí.'],
      { type:'listening', audio:'考试', question:'Listen. Which word did you hear?', options:['Exam','Question','Answer','Review'], correct:0, explanation:'考试 (kǎoshì) means exam.' },
      { type:'sentence_build', question:'Tap the words in order: “There is an exam tomorrow.”', tiles:['明天','有','考试'], explanation:'明天有考试 (Míngtiān yǒu kǎoshì) — There is an exam tomorrow.' }
    ]
  }
};

async function seedLesson(client, lessonId, data) {
  await client.query('DELETE FROM lesson_objectives WHERE lesson_id=$1', [lessonId]);
  await client.query('DELETE FROM lesson_content WHERE lesson_id=$1', [lessonId]);
  await client.query('DELETE FROM lesson_vocabulary WHERE lesson_id=$1', [lessonId]);
  await client.query('DELETE FROM lesson_examples WHERE lesson_id=$1', [lessonId]);
  await client.query(
    'DELETE FROM lesson_quiz_options WHERE question_id IN (SELECT question_id FROM lesson_quiz_questions WHERE lesson_id=$1)',
    [lessonId]
  );
  await client.query('DELETE FROM lesson_quiz_questions WHERE lesson_id=$1', [lessonId]);
  await client.query('DELETE FROM lesson_completion_settings WHERE lesson_id=$1', [lessonId]);

  let i = 1;
  for (const objective of data.objectives) {
    await client.query(
      'INSERT INTO lesson_objectives (lesson_id, objective, order_index) VALUES ($1,$2,$3)',
      [lessonId, objective, i++]
    );
  }

  i = 1;
  for (const [contentType, title, body] of data.content) {
    await client.query(
      'INSERT INTO lesson_content (lesson_id, content_type, title, body, order_index) VALUES ($1,$2,$3,$4,$5)',
      [lessonId, contentType, title, body, i++]
    );
  }

  i = 1;
  for (const [chinese, pinyin, english, pos, exCh, exPy, exEn] of data.vocabulary) {
    await client.query(
      `INSERT INTO lesson_vocabulary
        (lesson_id, chinese, pinyin, english, part_of_speech, example_chinese, example_pinyin, example_english, audio_url, order_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [lessonId, chinese, pinyin, english, pos, exCh, exPy, exEn, audioPath(chinese), i++]
    );
  }

  i = 1;
  for (const [speaker, chinese, pinyin, english] of data.examples) {
    await client.query(
      'INSERT INTO lesson_examples (lesson_id, speaker, chinese, pinyin, english, audio_url, order_index) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [lessonId, speaker, chinese, pinyin, english, audioPath(chinese), i++]
    );
  }

  i = 1;
  for (const entry of data.quiz) {
    const isObj = !Array.isArray(entry);
    const type = isObj ? entry.type : 'multiple_choice';
    let questionText, options, correctIdx, explanation, audioUrl = null;
    if (isObj && type === 'listening') {
      questionText = entry.question;
      options = entry.options;
      correctIdx = entry.correct;
      explanation = entry.explanation;
      audioUrl = audioPath(entry.audio);
    } else if (isObj && type === 'sentence_build') {
      questionText = entry.question;
      options = entry.tiles; // tile position = order_index; graded by sequence
      correctIdx = -1;
      explanation = entry.explanation;
    } else {
      [questionText, options, correctIdx, explanation] = entry;
    }
    const qr = await client.query(
      'INSERT INTO lesson_quiz_questions (lesson_id, question, question_type, explanation, points, order_index, audio_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING question_id',
      [lessonId, questionText, type, explanation, 1, i++, audioUrl]
    );
    const questionId = qr.rows[0].question_id;
    let j = 1;
    for (const optionText of options) {
      await client.query(
        'INSERT INTO lesson_quiz_options (question_id, option_text, is_correct, order_index) VALUES ($1,$2,$3,$4)',
        [questionId, optionText, type === 'sentence_build' ? true : (j - 1 === correctIdx), j]
      );
      j++;
    }
  }

  await client.query(
    'INSERT INTO lesson_completion_settings (lesson_id, passing_score, requires_quiz, min_attempts, completion_xp) VALUES ($1,$2,$3,$4,$5)',
    [lessonId, 80, true, 1, data.xp]
  );
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [lessonId, data] of Object.entries(LESSONS)) {
      await seedLesson(client, lessonId, data);
      console.log(`Seeded ${lessonId}`);
    }
    await client.query('COMMIT');
    console.log('Done.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FAILED', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
