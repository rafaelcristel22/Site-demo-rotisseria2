"""Gera um vídeo animado (MP4) de um jogador de futebol driblando, chutando e marcando um gol.

Uso:  python3 gerar_video.py [saida.mp4]
Requer: Pillow, numpy e ffmpeg no PATH.
"""
import math
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
S = 2  # supersampling para antialiasing
FPS = 30
DUR = 7.0
GROUND = 560  # linha do gramado onde ficam os pés

T_RUN_END = 2.6   # fim da corrida
T_KICK = 3.0      # instante do chute
T_GOAL = 4.0      # bola chega ao gol

GOAL_X, GOAL_TOP, GOAL_W = 1110, 330, 110

SKIN = (224, 172, 128)
SHIRT = (220, 30, 45)
SHORTS = (255, 255, 255)
SOCKS = (220, 30, 45)
BOOT = (25, 25, 25)
HAIR = (40, 25, 15)


def lerp(a, b, t):
    return a + (b - a) * t


def ease_out(t):
    return 1 - (1 - t) ** 3


def clamp(t, a=0.0, b=1.0):
    return max(a, min(b, t))


def font(size):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


FONT_BIG = font(150 * S)
FONT_SMALL = font(34 * S)


def background():
    img = Image.new("RGB", (W * S, H * S))
    d = ImageDraw.Draw(img)
    # céu
    for y in range(0, 300 * S):
        k = y / (300 * S)
        d.line([(0, y), (W * S, y)], fill=(int(lerp(60, 150, k)), int(lerp(120, 200, k)), int(lerp(200, 240, k))))
    # arquibancada
    d.rectangle([0, 200 * S, W * S, 300 * S], fill=(70, 70, 90))
    import random
    rnd = random.Random(7)
    for _ in range(900):
        x, y = rnd.randint(0, W * S), rnd.randint(205 * S, 295 * S)
        c = rnd.choice([(230, 40, 50), (250, 250, 250), (240, 200, 40), (40, 80, 200), (30, 30, 30)])
        d.ellipse([x, y, x + 5 * S, y + 5 * S], fill=c)
    d.rectangle([0, 292 * S, W * S, 302 * S], fill=(30, 30, 40))
    # gramado listrado
    for i in range(0, 14):
        c = (46, 140, 60) if i % 2 == 0 else (56, 158, 70)
        d.rectangle([i * 100 * S, 300 * S, (i + 1) * 100 * S, H * S], fill=c)
    # linhas do campo
    white = (235, 245, 235)
    d.line([(0, 600 * S), (W * S, 600 * S)], fill=white, width=4 * S)
    d.line([(930 * S, 330 * S), (870 * S, 690 * S)], fill=white, width=4 * S)
    d.line([(870 * S, 690 * S), (W * S, 690 * S)], fill=white, width=4 * S)
    return img


def draw_goal(d, bulge):
    white = (250, 250, 250)
    x0, x1 = GOAL_X * S, (GOAL_X + GOAL_W) * S
    top, bot = GOAL_TOP * S, (GROUND + 10) * S
    # rede
    net = (200, 200, 210)
    for i in range(0, 12):
        y = lerp(top, bot, i / 11)
        b = bulge * math.sin(math.pi * i / 11) * 25 * S
        d.line([(x0, y), (x1 + b, y)], fill=net, width=S)
    for j in range(0, 7):
        x = lerp(x0, x1, j / 6)
        pts = []
        for i in range(0, 12):
            k = i / 11
            pts.append((x + bulge * math.sin(math.pi * k) * 25 * S * (j / 6), lerp(top, bot, k)))
        d.line(pts, fill=net, width=S)
    # traves
    d.line([(x0, top), (x0, bot)], fill=white, width=10 * S)
    d.line([(x0, top), (x1, top)], fill=white, width=10 * S)
    d.line([(x1, top), (x1, bot)], fill=(180, 180, 180), width=6 * S)


def draw_ball(d, x, y, r=14, rot=0.0):
    x, y, r = x * S, y * S, r * S
    d.ellipse([x - r, y - r, x + r, y + r], fill=(250, 250, 250), outline=(30, 30, 30), width=2 * S)
    for k in range(5):
        a = rot + k * 2 * math.pi / 5
        px, py = x + math.cos(a) * r * 0.55, y + math.sin(a) * r * 0.55
        pr = r * 0.25
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(30, 30, 30))
    pr = r * 0.28
    d.ellipse([x - pr, y - pr, x + pr, y + pr], fill=(30, 30, 30))


def draw_shadow(d, x, y, w):
    d.ellipse([(x - w) * S, (y - 6) * S, (x + w) * S, (y + 6) * S], fill=(30, 90, 40))


def limb(d, p0, a1, l1, a2, l2, w1, w2, c1, c2, end=None):
    """Membro com 2 segmentos. Ângulos em radianos medidos a partir da vertical para baixo."""
    p1 = (p0[0] + math.sin(a1) * l1, p0[1] + math.cos(a1) * l1)
    p2 = (p1[0] + math.sin(a2) * l2, p1[1] + math.cos(a2) * l2)
    sp = lambda p: (p[0] * S, p[1] * S)
    d.line([sp(p0), sp(p1)], fill=c1, width=int(w1 * S))
    d.line([sp(p1), sp(p2)], fill=c2, width=int(w2 * S))
    for p, w, c in ((p0, w1, c1), (p1, w2, c2)):
        r = w * S / 2
        d.ellipse([p[0] * S - r, p[1] * S - r, p[0] * S + r, p[1] * S + r], fill=c)
    if end:
        r, c = end
        d.ellipse([p2[0] * S - r * S, p2[1] * S - r * S * 0.8, p2[0] * S + r * S * 1.3, p2[1] * S + r * S * 0.8], fill=c)
    return p2


def draw_player(d, x, y_hip, pose):
    """pose: dict com ângulos (rad) das coxas/canelas/braços e inclinação do tronco."""
    lean = pose["lean"]
    neck = (x + math.sin(lean) * 95, y_hip - math.cos(lean) * 95)
    shoulder = (x + math.sin(lean) * 82, y_hip - math.cos(lean) * 82)

    # membros de trás (mais escuros)
    dark = lambda c: tuple(int(v * 0.78) for v in c)
    limb(d, shoulder, pose["arm_b"], 38, pose["arm_b"] + pose["elb_b"], 34, 15, 12, dark(SHIRT), dark(SKIN))
    limb(d, (x, y_hip), pose["thigh_b"], 52, pose["thigh_b"] + pose["knee_b"], 54, 22, 15,
         dark(SHORTS), dark(SOCKS), end=(9, BOOT))

    # tronco
    hip = (x * S, y_hip * S)
    d.line([hip, (neck[0] * S, neck[1] * S)], fill=SHIRT, width=46 * S)
    r = 23 * S
    d.ellipse([neck[0] * S - r, neck[1] * S - r * 0.6, neck[0] * S + r, neck[1] * S + r * 0.6], fill=SHIRT)
    # calção
    d.ellipse([(x - 25) * S, (y_hip - 16) * S, (x + 25) * S, (y_hip + 18) * S], fill=SHORTS)
    # número 10
    cx = (x + math.sin(lean) * 50) * S
    cy = (y_hip - math.cos(lean) * 50) * S
    d.text((cx, cy), "10", fill=(255, 255, 255), font=font(24 * S), anchor="mm")

    # cabeça
    head = (neck[0] + math.sin(lean) * 26, neck[1] - math.cos(lean) * 26)
    hr = 21
    d.ellipse([(head[0] - hr) * S, (head[1] - hr) * S, (head[0] + hr) * S, (head[1] + hr) * S], fill=SKIN)
    d.chord([(head[0] - hr - 1) * S, (head[1] - hr - 2) * S, (head[0] + hr + 1) * S, (head[1] + hr) * S],
            175, 360, fill=HAIR)
    d.ellipse([(head[0] + 8) * S, (head[1] - 4) * S, (head[0] + 13) * S, (head[1] + 1) * S], fill=(20, 20, 20))

    # membros da frente
    limb(d, (x, y_hip), pose["thigh_f"], 52, pose["thigh_f"] + pose["knee_f"], 54, 22, 15,
         SHORTS, SOCKS, end=(9, BOOT))
    limb(d, shoulder, pose["arm_f"], 38, pose["arm_f"] + pose["elb_f"], 34, 15, 12, SHIRT, SKIN)


def leg_len(thigh, knee):
    return math.cos(thigh) * 52 + math.cos(thigh + knee) * 54


def run_pose(phase):
    s = math.sin(phase)
    return dict(
        lean=0.22,
        thigh_f=0.65 * s, knee_f=-(0.9 + 0.6 * max(0, -s)) * (0.5 + 0.5 * abs(math.cos(phase))) + 0.3,
        thigh_b=-0.65 * s, knee_b=-(0.9 + 0.6 * max(0, s)) * (0.5 + 0.5 * abs(math.cos(phase))) + 0.3,
        arm_f=-0.8 * s, elb_f=1.4, arm_b=0.8 * s, elb_b=1.4,
    )


def kick_pose(k):
    """k em [0,1]: 0..0.6 recuo, 0.6..0.7 golpe, 0.7..1 follow-through."""
    if k < 0.6:
        u = ease_out(k / 0.6)
        thigh_f, knee_f = lerp(0.2, -0.5, u), lerp(-0.5, -1.8, u)
    elif k < 0.7:
        u = (k - 0.6) / 0.1
        thigh_f, knee_f = lerp(-0.5, 1.1, u), lerp(-1.8, -0.1, u)
    else:
        u = ease_out((k - 0.7) / 0.3)
        thigh_f, knee_f = lerp(1.1, 1.5, u), lerp(-0.1, -0.3, u)
    return dict(lean=lerp(0.15, -0.15, clamp((k - 0.5) * 3)),
                thigh_f=thigh_f, knee_f=knee_f, thigh_b=-0.05, knee_b=0.0,
                arm_f=lerp(-0.4, 1.3, clamp(k * 1.4)), elb_f=0.6,
                arm_b=lerp(0.4, -1.4, clamp(k * 1.4)), elb_b=0.6)


def celebrate_pose(c):
    w = math.sin(c * 12)
    return dict(lean=-0.05, thigh_f=0.25, knee_f=-0.5, thigh_b=-0.2, knee_b=-0.6,
                arm_f=math.pi - 0.35 + 0.15 * w, elb_f=0.1, arm_b=math.pi + 0.35 - 0.15 * w, elb_b=-0.1)


def frame(bg, t):
    img = bg.copy()
    d = ImageDraw.Draw(img)

    # ---------- jogador ----------
    run_start, run_end = 120, 520
    jump = 0
    if t < T_RUN_END:
        u = t / T_RUN_END
        px = lerp(run_start, run_end, u)
        phase = t * 13
        pose = run_pose(phase)
        bob = abs(math.sin(phase)) * 6
    elif t < T_KICK + 0.5:
        k = clamp((t - T_RUN_END) / (T_KICK - T_RUN_END) * 0.65)
        if t > T_KICK:
            k = 0.65 + 0.35 * clamp((t - T_KICK) / 0.5)
        px = run_end + 25 * ease_out(clamp((t - T_RUN_END) / 0.9))
        pose = kick_pose(k)
        bob = 0
    else:
        c = t - (T_KICK + 0.5)
        px = run_end + 25
        pose = celebrate_pose(c) if t > T_GOAL else kick_pose(1.0)
        if t > T_GOAL:
            jump = abs(math.sin((t - T_GOAL) * 5)) * 45
        bob = 0
    support = max(leg_len(pose["thigh_f"], pose["knee_f"]), leg_len(pose["thigh_b"], pose["knee_b"]))
    y_hip = GROUND - support - bob - jump

    # ---------- bola ----------
    kick_x = run_end + 62
    if t < T_KICK:
        if t < T_RUN_END:
            bx = px + 55 + 18 * math.sin(t * 6.5)
        else:
            bx = lerp(run_end + 55 + 18 * math.sin(T_RUN_END * 6.5), kick_x, ease_out((t - T_RUN_END) / (T_KICK - T_RUN_END)))
        by = GROUND - 14 - abs(math.sin(t * 6.5)) * 8 * (1 if t < T_RUN_END else 0)
        rot = bx / 14
        br = 14
    elif t < T_GOAL:
        u = (t - T_KICK) / (T_GOAL - T_KICK)
        tx, ty = GOAL_X + 45, GOAL_TOP + 40
        bx = lerp(kick_x, tx, u)
        by = lerp(GROUND - 14, ty, u) - math.sin(math.pi * u) * 110
        rot = t * 25
        br = 14 - 2 * u
    else:
        u = clamp((t - T_GOAL) / 1.0)
        bx = GOAL_X + 45 + 30 * ease_out(u)
        by = lerp(GOAL_TOP + 40, GROUND - 12, ease_out(u))
        rot = 0
        br = 12
    bulge = 0.0
    if t > T_GOAL:
        e = t - T_GOAL
        bulge = math.exp(-e * 2.5) * abs(math.cos(e * 9)) + 0.15

    draw_goal(d, bulge)
    draw_shadow(d, px, GROUND + 2, 32 - jump * 0.2)
    draw_shadow(d, bx, GROUND + 2, max(6, 15 - (GROUND - by) * 0.03))
    ball_in_front = t < T_GOAL
    if not ball_in_front:
        draw_ball(d, bx, by, br, rot)
    draw_player(d, px, y_hip, pose)
    if ball_in_front:
        draw_ball(d, bx, by, br, rot)

    # ---------- textos ----------
    if t < 1.5:
        a = int(255 * clamp(1.5 - t))
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.text((W * S / 2, 90 * S), "O CRAQUE CAMISA 10", fill=(255, 255, 255, a), font=FONT_SMALL, anchor="mm")
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        d = ImageDraw.Draw(img)
    if t > T_GOAL + 0.1:
        u = clamp((t - T_GOAL - 0.1) / 0.35)
        scale = 0.3 + 0.7 * ease_out(u) + 0.04 * math.sin(t * 10)
        txt = Image.new("RGBA", (W * S, 260 * S), (0, 0, 0, 0))
        td = ImageDraw.Draw(txt)
        td.text((W * S / 2 + 6 * S, 136 * S), "GOOOL!", fill=(0, 0, 0, 160), font=FONT_BIG, anchor="mm")
        td.text((W * S / 2, 130 * S), "GOOOL!", fill=(255, 215, 0), font=FONT_BIG, anchor="mm",
                stroke_width=5 * S, stroke_fill=(180, 20, 30))
        tw, th = int(txt.width * scale), int(txt.height * scale)
        txt = txt.resize((tw, th), Image.LANCZOS)
        base = img.convert("RGBA")
        base.alpha_composite(txt, ((W * S - tw) // 2, int(150 * S - th / 2)))
        img = base.convert("RGB")

    return img.resize((W, H), Image.LANCZOS)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "jogador_futebol.mp4"
    bg = background()
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out],
        stdin=subprocess.PIPE)
    n = int(DUR * FPS)
    for i in range(n):
        proc.stdin.write(frame(bg, i / FPS).tobytes())
    proc.stdin.close()
    proc.wait()
    print(f"Vídeo salvo em {out} ({n} quadros, {DUR:.0f}s)")


if __name__ == "__main__":
    main()
