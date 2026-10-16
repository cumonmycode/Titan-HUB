import SwiftUI

/// Вкладка «Темы»: фон и акцентный цвет приложения.
struct ThemesView: View {
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible())], spacing: 14) {
                    ForEach(AppTheme.allCases) { item in
                        Button {
                            withAnimation(.smooth) { theme = item }
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(LinearGradient(colors: item.gradient, startPoint: .topLeading, endPoint: .bottomTrailing))
                                    .frame(height: 120)
                                    .overlay {
                                        Circle().fill(item.accent).frame(width: 30, height: 30).shadow(color: item.accent, radius: 12)
                                    }
                                HStack {
                                    Text(item.title).font(.headline)
                                    Spacer()
                                    if theme == item {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(item.accent)
                                    }
                                }
                            }
                            .glassCard(cornerRadius: 24, padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .appBackground()
            .navigationTitle("Темы")
        }
    }
}
