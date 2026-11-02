package fixture;
import org.springframework.security.crypto.bcrypt.BCrypt;
public final class Smoke { public static boolean roundTrip() { String h=BCrypt.hashpw("fixture-password", BCrypt.gensalt(4)); return BCrypt.checkpw("fixture-password",h) && !BCrypt.checkpw("different-password",h); } }
