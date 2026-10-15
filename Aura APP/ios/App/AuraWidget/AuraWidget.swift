//
//  AURA — Widget de pantalla de inicio (iOS)
//
//  QUÉ PUEDE Y QUÉ NO, Y POR QUÉ
//  Este widget NO lee datos de la app. No es una decisión de diseño: una
//  extensión de widget corre en su propio proceso, con su propio
//  contenedor de archivos, y la única forma de compartir el de la app es
//  un App Group. Apple no concede App Groups a las cuentas personales
//  gratuitas, así que con esa firma el cielo y los días acumulados están
//  fuera de alcance.
//
//  Lo que sí se puede, y resulta que es casi todo lo que importa: cinco
//  caras tocables. Cada una abre Aura con ese ánimo ya elegido, así que
//  registrar sigue siendo UN toque desde la pantalla de inicio. Lo único
//  que se pierde es que la app se abre en vez de guardar en silencio.
//
//  Si algún día hay cuenta de pago, lo que cambia es solo de dónde salen
//  los datos — el dibujo de las caras se queda igual.
//

import WidgetKit
import SwiftUI

// La misma rampa que usa la app y que ya usa el widget de Android.
private let COLOR_ANIMO: [Color] = [
    Color(red: 0.557, green: 0.525, blue: 0.769),   // 1  #8E86C4
    Color(red: 0.584, green: 0.729, blue: 0.910),   // 2  #95BAE8
    Color(red: 0.718, green: 0.698, blue: 0.918),   // 3  #B7B2EA
    Color(red: 0.839, green: 0.651, blue: 0.808),   // 4  #D6A6CE
    Color(red: 0.639, green: 0.851, blue: 0.824)    // 5  #A3D9D2
]
private let TEXTO  = Color(red: 0.204, green: 0.157, blue: 0.322)   // #342852
private let FONDO  = Color(red: 0.933, green: 0.941, blue: 0.980)   // #EEF0FA
private let FONDO_OSCURO = Color(red: 0.114, green: 0.094, blue: 0.180) // #1D182E

// MARK: - Datos (no hay: el widget es estático a propósito)

struct AuraEntry: TimelineEntry { let date: Date }

struct AuraProvider: TimelineProvider {
    func placeholder(in context: Context) -> AuraEntry { AuraEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (AuraEntry) -> Void) {
        completion(AuraEntry(date: Date()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AuraEntry>) -> Void) {
        // .never: no hay nada que refrescar, así que no se le pide a iOS
        // presupuesto de actualizaciones que no vamos a usar.
        completion(Timeline(entries: [AuraEntry(date: Date())], policy: .never))
    }
}

// MARK: - La cara

/// Misma geometría que la del widget de Android: lo único que cambia
/// entre las cinco es la curva de la boca.
struct Cara: View {
    let valor: Int

    var body: some View {
        GeometryReader { g in
            let lado = min(g.size.width, g.size.height)
            let r = lado * 0.42
            let cx = g.size.width / 2, cy = g.size.height / 2
            let curva = CGFloat(valor - 3) * r * 0.30

            ZStack {
                Circle()
                    .fill(COLOR_ANIMO[max(0, min(4, valor - 1))])
                    .frame(width: r * 2, height: r * 2)

                // Los ojos
                HStack(spacing: r * 0.68) {
                    Circle().fill(TEXTO).frame(width: lado * 0.105, height: lado * 0.105)
                    Circle().fill(TEXTO).frame(width: lado * 0.105, height: lado * 0.105)
                }
                .offset(y: -r * 0.22)

                // La boca: comisuras abajo en el 1, recta en el 3, arriba en el 5
                Path { p in
                    let bx = r * 0.40, by = cy + r * 0.30
                    p.move(to: CGPoint(x: cx - bx, y: by - curva * 0.5))
                    p.addQuadCurve(to: CGPoint(x: cx + bx, y: by - curva * 0.5),
                                   control: CGPoint(x: cx, y: by + curva * 1.6))
                }
                .stroke(TEXTO, style: StrokeStyle(lineWidth: lado * 0.055, lineCap: .round))
            }
            .frame(width: g.size.width, height: g.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// La estrella de cuatro puntas de Aura.
struct Estrella: View {
    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            let cx = w / 2, cy = h / 2, r = min(w, h) / 2, d = r * 0.26
            Path { p in
                p.move(to: CGPoint(x: cx, y: cy - r))
                p.addCurve(to: CGPoint(x: cx + r, y: cy),
                           control1: CGPoint(x: cx + d * 0.4, y: cy - d),
                           control2: CGPoint(x: cx + d, y: cy - d * 0.4))
                p.addCurve(to: CGPoint(x: cx, y: cy + r),
                           control1: CGPoint(x: cx + d, y: cy + d * 0.4),
                           control2: CGPoint(x: cx + d * 0.4, y: cy + d))
                p.addCurve(to: CGPoint(x: cx - r, y: cy),
                           control1: CGPoint(x: cx - d * 0.4, y: cy + d),
                           control2: CGPoint(x: cx - d, y: cy + d * 0.4))
                p.addCurve(to: CGPoint(x: cx, y: cy - r),
                           control1: CGPoint(x: cx - d, y: cy - d * 0.4),
                           control2: CGPoint(x: cx - d * 0.4, y: cy - d))
                p.closeSubpath()
            }
            .fill(COLOR_ANIMO[2])
        }
    }
}

// MARK: - Las vistas del widget

struct AuraWidgetView: View {
    @Environment(\.widgetFamily) var familia
    var entry: AuraEntry

    var body: some View {
        switch familia {
        case .systemSmall:  chico
        default:            mediano
        }
    }

    /// Chico: en este tamaño iOS no admite varios enlaces, así que todo
    /// el widget es un solo destino.
    var chico: some View {
        VStack(spacing: 8) {
            Estrella().frame(width: 30, height: 30)
            Text("¿Cómo te sientes?")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(TEXTO)
                .multilineTextAlignment(.center)
        }
        .widgetURL(URL(string: "aura://animo"))
        .fondoAura()
    }

    /// Mediano: las cinco caras, cada una su propio enlace.
    var mediano: some View {
        VStack(spacing: 10) {
            Text("¿Cómo te sientes hoy?")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(TEXTO)
            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { v in
                    Link(destination: URL(string: "aura://animo?valor=\(v)")!) {
                        Cara(valor: v)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .fondoAura()
    }
}

/// El fondo. containerBackground es obligatorio desde iOS 17; en versiones
/// anteriores se pinta a mano.
private extension View {
    @ViewBuilder func fondoAura() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { FONDO }
        } else {
            ZStack { FONDO; self }
        }
    }
}

// MARK: - Registro

struct AuraAnimoWidget: Widget {
    let kind = "AuraAnimoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AuraProvider()) { entry in
            AuraWidgetView(entry: entry)
        }
        .configurationDisplayName("Cómo te sientes")
        .description("Registra tu ánimo de un toque, sin buscar la app.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct AuraWidgetBundle: WidgetBundle {
    var body: some Widget { AuraAnimoWidget() }
}
