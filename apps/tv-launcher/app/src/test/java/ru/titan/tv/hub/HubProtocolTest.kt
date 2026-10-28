package ru.titan.tv.hub

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubProtocolTest {

    @Test
    fun `stream commands become remote commands`() {
        fun command(json: String) = (parseSignal("""{"type":"command","screenId":"s","command":$json}""") as HubSignal.Command).command
        assertEquals(HubCommand.Home, command("""{"action":"home","id":"1"}"""))
        assertEquals(HubCommand.Screensaver, command("""{"action":"screensaver","id":"2"}"""))
        assertEquals(HubCommand.Reset, command("""{"action":"reset","id":"3"}"""))
        assertEquals(HubCommand.Volume(40), command("""{"action":"volume","percent":40,"id":"4"}"""))
        assertEquals(HubCommand.Mute(true), command("""{"action":"mute","muted":true,"id":"5"}"""))
        assertEquals(
            HubCommand.Message("Через 10 минут время кабинки закончится", 20),
            command("""{"action":"message","text":" Через 10 минут время кабинки закончится ","seconds":20,"id":"6"}"""),
        )
    }

    @Test
    fun `out of range values are clamped`() {
        val volume = parseSignal("""{"type":"command","command":{"action":"volume","percent":250}}""") as HubSignal.Command
        assertEquals(HubCommand.Volume(100), volume.command)
        val message = parseSignal("""{"type":"command","command":{"action":"message","text":"Привет","seconds":999}}""") as HubSignal.Command
        assertEquals(HubCommand.Message("Привет", 120), message.command)
    }

    @Test
    fun `unknown, empty or broken events are ignored`() {
        assertNull(parseSignal("""{"type":"ready","screenId":"s"}"""))
        assertNull(parseSignal("""{"type":"command","command":{"action":"reboot"}}"""))
        assertNull(parseSignal("""{"type":"command","command":{"action":"message","text":"  "}}"""))
        assertNull(parseSignal("""{"type":"command","command":{"action":"volume"}}"""))
        assertNull(parseSignal("not json"))
        assertEquals(HubSignal.ContentChanged, parseSignal("""{"type":"content","screenId":"*"}"""))
    }

    @Test
    fun `ads keep cards with a qr and pictures`() {
        val content = parseAds(
            """
            {"adsVersion":"abc","ads":[
              {"kind":"card","imageUrl":null,"title":"My Titan","body":"Баланс и бонусы","qr":{"size":2,"bits":"1001"},"durationSec":10,"fit":"contain"},
              {"kind":"image","imageUrl":"https://titanpos.ru/a.jpg","title":null,"body":null,"qr":null,"durationSec":1,"fit":"cover"},
              {"kind":"card","imageUrl":null,"title":null,"body":null,"qr":null,"durationSec":10,"fit":"contain"}
            ]}
            """.trimIndent(),
        )!!
        assertEquals("abc", content.version)
        assertEquals(2, content.ads.size)
        val card = content.ads[0]
        assertFalse(card.isImage)
        assertEquals("My Titan", card.title)
        assertTrue(card.qr!!.isDark(0, 0))
        assertFalse(card.qr!!.isDark(1, 0))
        assertTrue(card.qr!!.isDark(1, 1))
        val picture = content.ads[1]
        assertTrue(picture.isImage)
        assertTrue(picture.fillsFrame)
        // Too short to read; a picture stays at least 3 s
        assertEquals(3, picture.durationSec)
    }

    @Test
    fun `a qr that does not match its size is dropped`() {
        val content = parseAds("""{"adsVersion":"v","ads":[{"kind":"card","title":"Instagram","qr":{"size":3,"bits":"101"}}]}""")!!
        assertNull(content.ads.single().qr)
    }

    @Test
    fun `pairing survives being stored`() {
        val pairing = HubPairing("https://kbr.titanpos.ru", "token", "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", "Маленькая кабинка")
        assertEquals(pairing, parsePairing(pairingJson(pairing)))
        assertNull(parsePairing("""{"host":"","token":"t","screenId":"s"}"""))
        assertNull(parsePairing("garbage"))
    }
}
