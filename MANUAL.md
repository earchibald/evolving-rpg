# The Manual

How to play the game, what everything in it means, and how to check it all
works — in plain words. The machinery lives in `WALKTHROUGH.md`; nothing in
here needs it.

---

## 1. Start

```bash
cd ~/Code/evolving-rpg
npm run dev        # then open the printed address
```

Your first five minutes: walk into the dark with the arrow keys. Fight the
first thing that finds you by walking into it. Pick up the blade it was
guarding by stepping onto it. Find the stairs. Go down.

The game talks to you constantly in the journal under the map. When in
doubt, read the last three lines — they always say what just happened.

**Long corridors walk themselves.** Hold shift and press a direction and you
walk that way on your own, a few paces a second, until a wall stops you or
until something worth looking at comes into view — a creature, a thing on the
floor, a trap you spot, the way out, or the corridor opening into a room. Any
key stops it. It will not start while something already has you in sight, and
it will not walk you onto a trap you have found.

---

## 2. The keys

| Key | What it does |
|---|---|
| arrows / wasd | walk — into a creature is an attack, into a wall costs nothing |
| `.` or space | stand still for a turn |
| shift + a direction | run — walk that way on your own, about three paces a second, until a wall or until anything new comes into sight |
| `x`, then a direction | shove — drive whatever stands beside you one pace |
| `z` | brace — set yourself against the coming round |
| `f` | the sling — press once to draw (everyone sees it), again to let fly |
| `q` / `Q` | use what your satchel holds — `q` the first thing, `Q` the second |
| `,` | take what is underfoot on purpose — trades, downgrades and scroll swaps included |
| `r` | read the scroll you carry — one turn, and the page is spent |
| `c` | the witness — the microphone listens while you play; again to stop |
| `t` | talk to the gamemaster — your character speaking, in there |
| `g` | the forge — where new laws are offered and accepted |
| `m` | the gamemaster's screen — the founding, your notes to the designer, and everything else |
| `n` | worlds — begin again, start another, wipe everything |
| `p` | the palette — every command in one searchable sheet |
| `?` | the keys, on screen |

The dungeon keys also sit on the bar under the map, always. Begin-again
lives in the worlds sheet now (`n`) — one stray keypress no longer resets
a run.

That is the whole game. Everything else is reading.

---

## 3. Words the game uses

| Word | What it means |
|---|---|
| **world** | one dungeon with its own name, names, laws and dead. Yours is called *main* until you make more |
| **floor** | one level of a world. Nine of them. The first is gentle |
| **the cut** | a floor's shape: *the door* (roomy, kind), *the warren* (tight, loopy), *the halls* (vast, open) |
| **relic** | a thing you wear — blade, charm, boots, lens. Better replaces worse on its own; worse stays on the floor |
| **satchel** | two carried things now. Walking fills a free hand; full hands leave the new thing lying (the game says so); `,` swaps your first thing out onto the tile. Two of the same is fine — two flares are two flares |
| **vital draught** | drink it: healed whole, and your health ceiling rises for good. Early or late, never wasted |
| **still smoke** | break it: for a few turns every hunt chases where you *were*. Useless against anything already beside you |
| **tallow flare** | strike it: light reaches seven paces around — walls and ways, never what stands in them |
| **ash ward** | wear it: the next blow that lands on you is drunk whole — no wound, no venom, no flinch — then it is spent. One warding at a time; it even holds a drawn shot steady through a hit |
| **iron burr** | cast it at your feet: everything hostile beside you reels and loses its next action. Worthless at range — they must already be on you |
| **hollow bell** | ring it: the way out answers from wherever it stands, and every unfound prize on the floor glints onto your map. Knowledge, never power |
| **scroll** | one page carried at a time, read with `r`, gone when read. Unread it wears a strange mark — "a scroll marked KOR-VETH" — and the first reading teaches this world what that mark means, forever. No scroll deals damage: they buy knowledge, position and time |
| **the boards** | a new world's ground, chosen at the door: **the vale** (the old 48×32), **the expanse** (four times the ground — the default), **the waste** (eight times). Bigger boards hold more of everything but thinner per step — the journey is the point. A wipe passes the same door: the one world that remains starts on the ground you pick there |
| **the window** | on big boards the map shows a window that follows you; the small see-through map floating in the window's corner keeps the whole journey, fog and all, with the window's frame drawn on. The way out is a green diamond on it, prizes are gold, you are white — and it fades almost away when you walk underneath it, so it never hides the tile you are standing on |
| **patrol** | some creatures walk rounds of the floor now instead of standing. A corridor that was empty is not empty forever |
| **a guard's post** | the keeper and every relic guard own their ground: chase or flee, they return to it rather than drifting off across the floor |
| **mimic** | very rarely, an item on the floor was never an item. The floor's story admits when something here is not what it seems; beasts give it a wide berth; reaching for it is how it is asked. It strikes first, and it always carries something worth the teeth |
| **trap** | marked ground you were sharp enough to see — or unmarked ground you were not. Two chances to know each one: a wits look when it first comes into view, a second, easier look the first time you pass close. Together those catch about three in four. A revealed trap wears an ember ring on the map, and the rail warns when one lies beside you. There is no way to disarm one — you route around it, or you walk it and hope |
| **the trap kinds** | spikes (blood, dodgeable), the venom needle (fast — learn to dodge it by level 3), the strangling snare (holds your legs a few rounds; blows still swing), the alarm bell (the whole floor knows you and comes for you — guards leave their posts, and it rings longer on a bigger board), the hatch and nest (things climb out, paces off), the maw (the floor gives way — the next floor down, no rest), the lodestone (elsewhere, instantly) |
| **spill** | what a slain creature was carrying, set down where it fell. About one in three carries something — the reason a fight in a corridor can pay |
| **shove** | your push. It never misses: open ground moves them, a wall hurts them, another body tangles both. The wall is the argument |
| **brace** | your guard, for one round: harder to hit, no trample can move you, a coiled spring breaks on it — and whatever misses you reels |
| **reeling** | what a staggered thing does: it loses its next turn. Shoves into walls, tangles, and blows that break on a set guard all cause it |
| **venom** | some bites keep costing: one point a round for three rounds after. Breaking off a fight no longer ends it |
| **leaden sling** | a weapon that reaches, worn in its own hand BESIDE your blade — sword and sling together now. Its might adds to yours (strong arms throw hard), and it fights in two beats: draw, then let fly. What you set down when swapping any gear lands on the floor where the new piece lay |
| **drawing** | half of every shot, and all of its warning. Drawing costs a turn and everyone can see it. Standing still keeps it; moving, swinging, or being hurt loses it, shot unfired |
| **what stops a stone** | walls. Hidden doors, until found. Any living body in the way — theirs or yours. Distance past five rings. And anything standing right beside the thrower: up close, the fight belongs to fists and blades |
| **slinger** | the creature that fights the same way. When it draws back its arm you have one turn: step behind something, close in, brace, or shove it — or take the stone |
| **warden** | the boss. Stands at the stairs every third floor and will not be drawn far from them. Run away and its wounds close — a boss poked is a boss unpoked |
| **the heart** | what beats at the bottom of the ninth floor. Taking it is not the end — carrying it out is |
| **echo** | one of your past selves, risen. Only at the bottom, only where your bodies lie |
| **the forge** | where a proposed law becomes a real one, or doesn't. Nothing changes without your yes |
| **law** (rule) | a sentence the world now obeys, like *"when you hold still, hurt and alone — you mend."* Laws survive death and follow you downstairs |
| **the bench** | laws proposed and tested while you were away, waiting in the forge for your yes or no |
| **founding** | a new world deciding what it *is* — its story, its words, who its warden is, what it promises. Takes about forty seconds, once |
| **grave** | a run that ended. Kept forever, marked with a **†** in the worlds list |
| **body** | where you fell, still lying there in later runs. Stand on it and that life shows you the floor as it knew it |
| **the stone** | every ended run is written down. A one-line stone is cut the instant you fall; endings that matter — a first life, a new deepest floor, a warden's kill, a win — get the world's fuller words a little later. The full words are only ever read in one place: standing where the body lies |
| **the witness** | the small indicator at the top. Dim: off. Red and breathing: the microphone is keeping your words, stamped to the turn you said them on. `c` or a click toggles it |
| **the listener** | the reader every submitted run goes to — what happened, what you typed, what you *said out loud* — reporting on where the fun lives and where it breaks. Its reports pile up in `runs/feedback/` |

---

## 4. How a run goes

**Fight** by walking into things. Hover any number on the right rail and it
explains itself — what you need to roll, what you deal, what it deals.

**Level** by killing. Each level heals you whole and makes you more.

**Gear up.** Every floor guards a relic or two. The guard is the price.
Walking over a relic takes it only when it is better in every way; anything
that asks a trade — the heavy blade that costs you a pace of speed, a
sidegrade, even a downgrade you have reasons for — waits on the floor until
you take it on purpose with `,`. The journal always says which kind of
refusal you are looking at, and always names the key that answers it. A
`,` that comes up empty answers too — "nothing lies here", or the heart
sealing your hands — and it never costs a turn.

**Carry two things.** Every floor also leaves one provision lying somewhere
off the path, free. Floor one keeps to the first three kinds — the draught,
the smoke, the flare — and deeper floors add the ward, the bell, and the
burr to what may turn up. Which two to carry, and when to spend them, is
yours to get wrong.

**Choose your ground.** "Another world" (`n`) asks first: the vale, the
expanse, or the waste — and a seed, if you want one. Type a number, or a
word: "ashfall" is a seed you can tell a friend. A world keeps its size
all the way down.

**Watch the ground.** From floor two the floors keep traps. Most are
found things — your eyes do the work as you walk — and found traps are
marked and warned about. Roughly one in four gets past you, though, so
the ground is worth your attention rather than your trust. The unfound
ones are the stories. If the floor gives way under you, that is not a
death: it is the next floor, arrived at hard. And if you ring the alarm
bell, do not stand there listening to it — the floor comes, guards and
all, for as long as it rings.

**The stairs are not always far.** Most floors put the way out at the
long end of a long walk, but not all of them: sometimes it is the middle
distance, and every so often it is one room away. The floor's own story
line says which kind you got. A close stair is not a gift — the prize
and the provision still lie off your road, guarded, so a short floor
asks whether you came down here to descend or to be paid.

**Trust carefully.** The floor's story tells you when one thing here is
not what it seems. Items the beasts walk wide of deserve a second look —
or a stone from range... which the sling refuses. The bump is the only
question a lie answers.

**Fighting pays twice now.** Kills pay experience as always — and about
one in three creatures spills what it carried. The mimic always does.

**Descend** by stepping on the green square. The strongest thing on the
floor watches it. Clear the whole floor first and you descend healed —
unless the floor descended *you* (the maw earns no rest).

**Die** and the world keeps your fall: the run becomes a grave, your body
stays where it dropped, a one-line stone is cut on the spot — floor, turn,
what struck the blow — and the world, unasked, reads your death back and
proposes a law about it. If the death was not ordinary, the world takes a
minute and writes more; the journal tells you the words exist, but they
are only read out where the body lies. Press `r` to rise and go again.
Laws and the world's identity survive; the floors are rebuilt exactly;
your body from last time is lying where you left it, and walking back to
it is how you hear what the world remembers of you.

---

## 5. The creatures

They do not differ by numbers. They differ by what they *do*:

| Creature | Its move | The tell |
|---|---|---|
| **bruiser** | its blows knock you back a pace, and it lumbers after you | "the blow drives you back a pace" |
| **skirmisher** | crosses two tiles and strikes in one motion — approaching it carelessly *is* the mistake | "it lunges" |
| **stalker** | lies perfectly still, in plain sight, until you come three steps too close. Its first blow lands harder | "it stirs from its stillness" |
| **stinger** | its bite is small; the venom in it is not. Three rounds of burning after every landed bite | "the bite burns" |
| **caller** | frail, and it does not want to fight you — it wants you heard. One cry and the floor sends two more | "it cries out — and the floor answers" |
| **warden** | holds its post and cannot be lured away. Flee past its leash and it walks home and knits shut | "it resumes its vigil" |
| **mimic** | is an item, until you reach for it. First blow lands harder — then it fights plain, and it dies carrying treasure | "it unfolds, teeth first" |

A thing standing eerily still in an open room is not decoration. The rail
says *coiled* next to its name. A caller's rail line says *unspent voice*.
Believe both. And you have moves of your own now: shove them into walls
and into each other, brace when you have read what is coming.

Some of them have somewhere to be: guards keep their rooms and walk home
when a chase empties, and from floor two a share of the floor walks
patrol rounds. An empty corridor is a fact about *now*.

---

## 6. The bottom

The first floor tells you: **the world runs nine floors deep, and
something beats at the bottom.**

The ninth floor is backwards. The stairs you arrive by are the only way
out, and the heart lies at the far end, behind the last warden. On the
way down, the world drops hints — floors two, five and eight each whisper
one of the world's promises, and each warden's fall confirms one.

Take the heart and everything changes:

- your hands are full — the satchel is sealed until the end,
- every eight turns, the floor raises something against you,
- the first thing it raises is *you*: an echo stands up from every body
  you ever left on that floor, as strong as you are now,
- the way out is the long walk back.

Reach the stairs still carrying it, and the world is **won**.

---

## 7. Why no two worlds feel the same

A new world is *founded*: it decides in one stroke what it is — a drowned
mine, a frost archive — which words it speaks in, who its warden is, and
what it promises you. Every name in it is drawn from that one identity,
and no world ever borrows another's names. Wipe it and the next one will
be someone else entirely.

Talk to the gamemaster with `t` — it answers from inside the world's own
fiction, and it knows how you stand: your floor, your wounds, what you
carry. Notes to the game designer — you, out here, about the game — live
in the screen (`m`); the world reads them when it proposes laws. Every
entry in both conversations keeps the moment it was said: floor, turn,
level, health, burden. Read an old exchange and you see where you stood
when you said it.

---

## 8. The forge, plainly

Laws reach you three ways:

1. **Your death proposes one.** Every death is read back; the forge opens
   when the offer lands.
2. **You ask.** After a run ends, press `g` and ask the world for a law.
3. **The bench.** Laws proposed and play-tested while you were away wait
   in the forge. They knock once; refuse them and they stay refused.

Every offer shows the law in a sentence, why it was proposed, and what the
trials made of it — including a warning when a law is heavier than it
looks. **Accept**, **edit** (the form cannot build an illegal law), or
**reject**. Nothing enters the world without your yes, and nothing you
accept escapes the trials: a law that mints strength from repetition, or
makes death impossible, is refused before you ever see it.

---

## 9. Say it out loud — the witness and the listener

The game cannot feel itself being played. You can. So: press `c` (or click
the dim indicator at the top), allow the microphone once, and just talk
while you play — *"why would I ever shove"*, *"this floor drags"*, the
sigh before a door. The dot burns red while it listens. Press `c` again to
stop; your words are written down on your own machine, by the machine —
nothing leaves it.

When you end a run — begin again, another world, or a wipe — the run is
taken away and read: everything that happened, everything you typed, and
everything you said, lined up on one clock, silences included. A minute
later the journal prints the verdict in one line, and the full reading —
your words quoted back, tied to the exact turns, with recommendations —
lands in `runs/feedback/`. Dying does not trigger this; *choosing to be
done* does.

You do not have to speak. A silent run still gets read. But the spoken
words are the sharpest instrument this game has for finding out why it
is not fun *yet* — say the quiet part into the microphone.

---

## 10. Try this — the test guide

Each line is one check. Do the thing; expect the thing. If the game does
something else, that is a finding worth reporting.

| Do | Expect |
|---|---|
| start a fresh world (`n` → wipe → choose a ground) | within a minute: "the world is founded — …" and every name arrives at once, instantly, in the founding's own words. Escape at the door instead: nothing is wiped |
| read the founding (`m` → this world) | a story, a word-list, a named warden, two or three promises |
| walk into a wall | "blocked" — and no turn passes |
| walk into a creature | a to-hit line with real numbers; hover the rail to see the same numbers explained |
| watch a bruiser hit you | you are shoved back a pace and it follows |
| approach a *coiled* thing to three steps | it stirs; its first landed blow is noticeably harder |
| step off, then back onto a floor provision | it swaps with your satchel both times; nothing is ever lost |
| press `q` holding the draught while hurt | healed whole, ceiling raised, one turn spent |
| press `q` holding the smoke mid-chase | pursuers walk to where you *were*; anything adjacent keeps fighting |
| fight the warden, then run five+ steps away | it goes home; its wounds visibly close |
| press `x` and a direction at something beside a wall | it is driven into the wall, takes 1, and loses its next turn |
| press `z`, then let a bruiser swing | its shove fails against your stance; if it misses you, it reels |
| let a stinger bite you, then walk away | the venom burns 1 a round for 3 rounds — the rail counts it down |
| walk toward a *caller* | one cry, and two more things rise far off — kill it first next time |
| walk over the heavy blade | it stays put and the journal says it asks a trade; `,` takes it, speed and all |
| walk over a relic worse than yours | "no better than your … — it stays where it lies; type , to take it anyway" — and `,` does |
| press `,` on bare floor | "you stoop — nothing lies here to take", and no turn passes |
| strike a flare in a corridor | the map fills in for seven paces around — shape only, nothing that stands in it |
| wear the ward, then let a warden swing | its blow lands and is drunk whole; the rail's ward row disappears — one blow, exactly |
| cast the burr in a surround | everything beside you reels; the far ones keep coming |
| ring the bell on a big floor | the exit square appears on your map, dim, wherever it stands |
| die | body on the map, a † world in the list, "the stone is cut" with the real floor, turn and killer — and, unasked, a proposed law within a minute |
| die a death that matters (a first life, a new deepest floor, a warden) | a minute later: "the world has set … down in full" — first words only, the rest withheld |
| press `r` and walk to where you died | "you stand where you fell" — that life's floor joins your map, and the world recites its full words for that life, right there |
| hover a "remembered" grave in the worlds list | the stone's words, whole |
| open the forge on a fresh world | the bench: two waiting laws about rest and the aftermath, each with its trial verdict |
| press `t`, ask the world a question | an answer in the world's voice — and under the entry, the moment it was said: floor, turn, level, health |
| take a wound, ask again, then read both entries | each keeps its own moment; the old one does not change |
| descend to floor two | a whispered promise in the journal |
| kill the floor-three warden | "the promise holds — …" |
| reach floor nine, take the heart | satchel sealed, waves begin, echoes rise if you ever died there |
| carry it back to the entry stairs | **won** |
| `n` → another world → type "ashfall" → the waste | a 128×96 world; the map becomes a window that follows you, with the journey map beside it |
| stand still where you can see far, on floor 2+ | sooner or later: "your eye catches it — a spike pit, marked" — an ember ring on the map |
| step onto a marked trap anyway | a dodge roll with real numbers — or the price, itemized |
| pick up a scroll, press `r` | "you read … —" and the mark on it becomes a name, in this world, forever |
| kill things until one folds mid-corridor | "something spills from it as it falls — …" and a prize lies where it fell |
| find the item the beasts walk around | reach for it. "it unfolds, teeth first." you were warned |
| press `p` | every command, searchable; type "forge", enter — the forge opens |
| press `v` any time | "chain verified" — the whole history checks out |
| press `c`, allow the microphone | the indicator burns red and breathes; "the witness listens" in the journal |
| say "this fight is boring" mid-fight, press `c` again | "the witness has your words — …s, being written down" |
| end the run (`r`, or `n` → any option) | "the listener takes this run away to read" — and about a minute later, its one-line verdict and a path under `runs/feedback/` |
| open that report | your words quoted verbatim, tied to the turns you said them at, and recommendations that name the mechanism |

---

## 11. When something looks wrong

| It says | It means |
|---|---|
| plain names like "skirmisher" for a minute | the founding is still being decided; names land all at once the moment it does. Names are made by the game itself now — no waiting on a model, ever |
| "the worldsmith's offer was refused" | the model wrote a bad founding. The world plays on and names itself from a stock palette — start another if you want a voice of its own |
| "no rule this time" | the world read your run and found nothing worth proposing. That is an answer, not an error |
| a queue entry stuck "asking" for minutes | that call failed quietly; reload the tab and it clears. Anything answered is already saved |
| the same world twice feels identical | it is meant to — same world, same floors, forever. *Different* worlds must feel different |
| "the witness cannot hear" | the browser refused the microphone, or the permission prompt was never answered. Click the indicator and allow it; the game plays on either way |
| "the listener could not be reached" | no dev server, or the reading failed. The run itself is safe — nothing about play depends on the listener |

---

*The deeper machinery — how replays, trials, verification and the agent
tooling work — is in `WALKTHROUGH.md` and `AGENTS.md`.*
